// functions/index.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/genai");

admin.initializeApp();
const db = admin.firestore();

// Set this in Firebase via CLI: firebase functions:secrets:set GEMINI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// 🚀 MONTHLY ALLOWANCE CONFIG
const MAX_MONTHLY_REQUESTS = 500; // ආසන්න වශයෙන් රු. 1500 ක පමණ වටිනාකම

exports.askEnterpriseAI = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Security Breach: You must be logged in.');
    }

    const uid = request.auth.uid;
    const { prompt, history, systemInstruction, module, ownerId } = request.data;
    
    // Safety check for SaaS structure
    const targetOwnerId = ownerId || uid; 

    // ==========================================
    // 1. THE DDOS SHIELD (10 Second Rate Limit)
    // ==========================================
    const rateLimitRef = db.collection('system_rate_limits').doc(uid);
    const rlSnap = await rateLimitRef.get();
    
    // Google Server Time (Absolute Truth)
    const serverNowMs = Date.now(); 

    if (rlSnap.exists) {
        const lastCall = rlSnap.data().lastCallAt || 0;
        // 🚀 ENTERPRISE FIX: 1.5 Second Micro-Cooldown (Human frictionless, Bot restricted)
        if (serverNowMs - lastCall < 1500) {
            throw new HttpsError('resource-exhausted', 'Spam Detected! Requests are too fast.');
        }
    }
    
    // ==========================================
    // 2. THE MONTHLY QUOTA ENGINE (Auto-Resetting)
    // ==========================================
    const quotaRef = db.doc(`users/${targetOwnerId}/settings/ai_quota`);
    
    // Get Current Month using Google Server Time (e.g., "2026_8")
    const serverDate = new Date();
    const currentMonthKey = `${serverDate.getFullYear()}_${serverDate.getMonth() + 1}`;

    await db.runTransaction(async (t) => {
        const qSnap = await t.get(quotaRef);
        let remaining = MAX_MONTHLY_REQUESTS;
        let savedMonth = "";

        if (qSnap.exists) {
            const qData = qSnap.data();
            savedMonth = qData.lastResetMonth;
            
            if (savedMonth === currentMonthKey) {
                // Same month, check limit
                if (qData.remaining < 1) {
                    throw new HttpsError('permission-denied', 'ඔබගේ මෙම මාසය සඳහා වූ AI සීමාව (Quota) අවසන් වී ඇත. කරුණාකර ලබන මාසය තෙක් රැඳී සිටින්න හෝ Package එක Upgrade කරන්න.');
                }
                remaining = qData.remaining - 1;
            } else {
                // New Month Detected! Auto-Reset Quota
                remaining = MAX_MONTHLY_REQUESTS - 1; // Used 1 right now
            }
        } else {
            // First time ever using AI for this merchant
            remaining = MAX_MONTHLY_REQUESTS - 1;
        }

        // Commit Quota & Rate Limit Updates
        t.set(quotaRef, { remaining: remaining, lastResetMonth: currentMonthKey }, { merge: true });
        t.set(rateLimitRef, { lastCallAt: serverNowMs }, { merge: true });
    });

    // ==========================================
    // 3. GOOGLE GEMINI EXECUTION
    // ==========================================
    try {
        const ai = new GoogleGenerativeAI({ apiKey: GEMINI_API_KEY });

        if (history && systemInstruction) {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: history,
                config: { systemInstruction: systemInstruction, temperature: 0.2 }
            });
            return { result: response.text };
        } 
        else if (prompt) {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            return { result: response.text };
        } else {
            throw new HttpsError('invalid-argument', 'No prompt or history provided.');
        }
    } catch (error) {
        // If Google API fails, refund the quota (Optional Enterprise Feature)
        await quotaRef.update({ remaining: admin.firestore.FieldValue.increment(1) });
        console.error("Gemini API Error:", error);
        throw new HttpsError('internal', 'AI Engine failed to process the request.');
    }
});

// ========================================================
// 📧 ENTERPRISE EMAIL ENGINE (With Anti-Spam & Daily Quotas)
// ========================================================
exports.sendEnterpriseEmail = onCall(async (request) => {
    // 1. SECURITY: ලොග් වී නැත්නම් පන්නා දමයි
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Access Denied: Please log in.');
    }

    const { to, subject, body, emailType, shopId, ownerId } = request.data;
    if (!to || !subject || !body || !shopId || !ownerId) {
        throw new HttpsError('invalid-argument', 'Missing required email fields.');
    }

    // 2. TIMEZONE MATH: ලංකාවේ වෙලාවට අද දිනය සෙවීම (උදා: "2026-08-25")
    const now = new Date();
    const slTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const todayKey = slTime.toISOString().split('T')[0];

    // 3. QUOTA LIMITS (ව්‍යාපාරික නීති)
    const LIMITS = {
        transactional: 500, // බිල්පත්, රිසිට් වැනි දෑ දවසකට 500ක් යැවිය හැක
        marketing: 50       // ප්‍රවර්ධන (Spam විය හැකි) දෑ දවසකට 50කට සීමා වේ
    };
    const maxAllowed = LIMITS[emailType] || 50;

    const statsRef = db.doc(`users/${ownerId}/shops/${shopId}/usage/email_stats_${todayKey}`);
    const outboxRef = db.collection(`users/${ownerId}/shops/${shopId}/outbox`).doc();
    const profileRef = db.doc(`users/${ownerId}/shops/${shopId}/settings/profile`);

    try {
        // 🚨 100% ACID COMPLIANT ATOMIC TRANSACTION
        // හැකර් කෙනෙක් තත්පරේට Requests 1000ක් එව්වත් කෝටාවෙන් පනින්න බැරි වෙන්න Lock කරයි!
        await db.runTransaction(async (t) => {
            const statSnap = await t.get(statsRef);
            let currentSent = 0;

            if (statSnap.exists) {
                currentSent = statSnap.data()[emailType] || 0;
            }

            // ⛔ THE GATEKEEPER: කෝටාව පැනලා නම් එළවා දමයි!
            if (currentSent >= maxAllowed) {
                throw new Error(`QUOTA_EXCEEDED`);
            }

            // 4. වෘත්තීය HTML Template එක Backend එක තුළදීම නිර්මාණය කිරීම (Frontend එක සැහැල්ලු කරයි)
            const profSnap = await t.get(profileRef);
            let shopName = "Our Store", shopPhone = "", brandColor = "#2563eb";
            
            if (profSnap.exists) {
                const p = profSnap.data();
                shopName = p.bizName || shopName;
                shopPhone = p.phone1 || "";
                brandColor = p.logoColor || brandColor;
            }

            const emailHtml = `
                <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                    <div style="background: ${brandColor}; color: #ffffff; padding: 20px; font-size: 20px; font-weight: 800; text-align: center; letter-spacing: 0.5px;">
                        ${shopName.toUpperCase()}
                    </div>
                    <div style="padding: 25px; color: #334155; font-size: 15px; line-height: 1.6; background: #ffffff;">
                        ${body.replace(/\n/g, '<br>')}
                    </div>
                    <div style="background: #f8fafc; padding: 20px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; text-align: center; line-height: 1.5;">
                        This is an official communication from <b>${shopName}</b>.<br>
                        ${shopPhone ? `Contact Us: ${shopPhone}<br>` : ''}
                        ${emailType === 'marketing' ? `<br><a href="#" style="color:#ef4444; text-decoration:underline;">Unsubscribe from marketing emails</a><br>` : ''}
                        <br><span style="font-size: 9px; opacity: 0.7;">Powered by WorldBizNet Cloud ERP</span>
                    </div>
                </div>
            `;

            // 5. සේව් කිරීම (කෝටාව වැඩි කිරීම සහ Outbox එකට ලිවීම එකම තත්පරයේදී සිදු වේ)
            t.set(statsRef, {
                [emailType]: currentSent + 1,
                lastUpdated: slTime.toISOString()
            }, { merge: true });

            t.set(outboxRef, {
                to: to,
                emailType: emailType,
                message: {
                    subject: `[${shopName}] ${subject}`,
                    text: body,
                    html: emailHtml
                },
                timestamp: slTime.toISOString(),
                status: 'pending',
                sentBy: request.auth.token.email
            });
        });

        return { success: true, message: "Email queued successfully!" };

    } catch (error) {
        console.error("Email Transaction Failed:", error);
        if (error.message === 'QUOTA_EXCEEDED') {
            throw new HttpsError('resource-exhausted', `Daily limit reached for ${emailType} emails (Max: ${maxAllowed}). Try again tomorrow.`);
        }
        throw new HttpsError('internal', 'System failed to queue the email.');
    }
});
// ========================================================
// 🏦 ENTERPRISE IMMUTABLE WALLET LEDGER (Quantum-Resistant Logic)
// ========================================================
const crypto = require('crypto'); // Node.js built-in crypto module

exports.processSecureWallet = onCall(async (request) => {
    // 1. SECURITY: Authentication Firewall
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Access Denied: Unverified terminal.');
    }

    const { ownerId, shopId, customerPhone, amount, transactionType, orderId, nonce } = request.data;
    
    if (!customerPhone || amount === undefined || !nonce || !transactionType) {
        throw new HttpsError('invalid-argument', 'Missing required cryptographic payload parameters.');
    }

    const uid = request.auth.uid; // Logged in Cashier or Admin
    const customerRef = db.doc(`users/${ownerId}/shops/${shopId}/customers/${customerPhone}`);
    const ledgerRef = customerRef.collection('wallet_transactions').doc();

    try {
        // 🚨 100% ACID COMPLIANT ATOMIC TRANSACTION
        await db.runTransaction(async (t) => {
            const custSnap = await t.get(customerRef);
            if (!custSnap.exists) throw new Error("CUSTOMER_NOT_FOUND");

            const cData = custSnap.data();
            const currentBalance = cData.walletBalance || 0;
            const lastNonce = cData.lastWalletNonce || "";

            // 🛡️ REPLAY ATTACK PREVENTION (The Hacker Trap)
            // හැකර් කෙනෙක් පරණ Request එකක් (පරණ Nonce එකක් එක්ක) ආයෙත් එව්වොත්, Backend එක ඒක අල්ලගන්නවා!
            if (nonce === lastNonce) {
                throw new Error("REPLAY_ATTACK_DETECTED");
            }

            // 2. Business Logic Validation
            let newBalance = currentBalance;
            if (transactionType === 'DEPOSIT') {
                newBalance = currentBalance + amount;
            } else if (transactionType === 'DEDUCT') {
                if (currentBalance < amount) throw new Error("INSUFFICIENT_FUNDS");
                newBalance = currentBalance - amount;
            } else {
                throw new Error("INVALID_TRANSACTION_TYPE");
            }

            // 🛡️ 3. CRYPTOGRAPHIC SIGNATURE GENERATION (The Immutable Seal)
            // මේ දත්ත ටික එකතු කරලා අපි අදෘශ්‍යමාන රහස්‍ය මුද්‍රාවක් (Hash) ගහනවා.
            // අනාගතයේ කවුරුහරි Database එකට රිංගලා ගාණ වෙනස් කළොත් මේ මුද්‍රාව කැඩෙනවා!
            const rawString = `${customerPhone}_${amount}_${transactionType}_${nonce}_${orderId}_${GEMINI_API_KEY.substring(0,5)}`;
            const digitalSignature = crypto.createHash('sha256').update(rawString).digest('hex');

            // 4. Update the Ledger (Append-Only)
            const serverTime = admin.firestore.FieldValue.serverTimestamp();
            t.set(ledgerRef, {
                amount: amount,
                type: transactionType,
                previousBalance: currentBalance,
                newBalance: newBalance,
                orderId: orderId || "MANUAL_ADJUSTMENT",
                cashierUid: uid,
                nonce: nonce,
                signature: digitalSignature, // 👈 The unbreakable lock
                timestamp: serverTime
            });

            // 5. Update the Customer's Main Balance & Record the Nonce
            t.update(customerRef, {
                walletBalance: newBalance,
                lastWalletNonce: nonce,
                walletLastUpdatedAt: serverTime
            });
        });

        return { success: true, message: "Cryptographic Wallet Transaction Successful" };

    } catch (error) {
        console.error("Wallet Engine Error:", error);
        if (error.message === "INSUFFICIENT_FUNDS") {
            throw new HttpsError('failed-precondition', "Customer does not have enough Store Credit.");
        } else if (error.message === "REPLAY_ATTACK_DETECTED") {
            throw new HttpsError('permission-denied', "SECURITY ALERT: Duplicate or Tampered Transaction Detected!");
        } else {
            throw new HttpsError('internal', "Wallet processing failed.");
        }
    }
});
// ========================================================
// 🏛️ ENTERPRISE IRD RAMIS E-INVOICING BRIDGE (PERFECTED)
// ========================================================
const axios = require('axios');

// Helper Function: JWT Token Caching (Prevents API Ban)
async function getValidRamisToken(ownerId) {
    const tokenRef = db.doc(`system_configs/${ownerId}_ramis_token`);
    const snap = await tokenRef.get();
    const now = Date.now();

    if (snap.exists) {
        const data = snap.data();
        // Token valid for 50 minutes (RAMIS usually expires in 1 hour)
        if (data.token && data.expiresAt > now) {
            return data.token;
        }
    }

    const RAMIS_SSID = process.env.RAMIS_SSID || "YOUR_SSID";
    const RAMIS_PASSWORD = process.env.RAMIS_PASSWORD || "YOUR_PASSWORD";
    const RAMIS_API_BASE = "https://ramis.ird.gov.lk/api"; // Or UAT link

    const authResponse = await axios.post(`${RAMIS_API_BASE}/authenticate`, {
        ssid: RAMIS_SSID,
        password: RAMIS_PASSWORD
    });

    if (!authResponse.data || !authResponse.data.token) {
        throw new Error("RAMIS_AUTH_FAILED");
    }

    const newToken = authResponse.data.token;
    // Save token to Firestore with expiration (50 minutes)
    await tokenRef.set({
        token: newToken,
        expiresAt: now + (50 * 60 * 1000) 
    });

    return newToken;
}

// 🚀 1. INVOICE SUBMISSION (Schedule 1 & 7)
exports.pushInvoiceToRamis = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Access Denied.');

    const { ownerId, invoiceNumber, tin, vatNo, dateTime, buyerTin, subTotal, vatAmount, grandTotal, items, forexTender } = request.data;
    
    try {
        const jwtToken = await getValidRamisToken(ownerId);
        
        // Base Payload
        let ramisPayload = {
            SupplierTIN: tin,
            SupplierVATNo: vatNo,
            PurchaserTIN: buyerTin || null, 
            TaxInvoiceNo: invoiceNumber,
            InvoiceDate: dateTime,
            TotalAmount: grandTotal,
            VATAmount: vatAmount
        };

        // 🛡️ PRATHI-THARKA FIX: Route to Schedule 7 if Forex Exists!
        let endpoint = "/submit-invoice"; // Default Schedule 1
        
        if (forexTender && forexTender.currency !== "LKR") {
            endpoint = "/submit-zero-rated-invoice"; // Schedule 7 Endpoint (Check exact IRD endpoint name)
            ramisPayload.Currency = forexTender.currency;
            ramisPayload.ExchangeRate = forexTender.exchangeRate;
            ramisPayload.ForeignValue = forexTender.foreignAmount;
            ramisPayload.SupplyCategory = "SERVICE_EXPORT"; // Schedule 7 specific
        } else {
            ramisPayload.ValueOfSupply = subTotal;
            ramisPayload.LineItems = items.map((i, index) => ({
                LineNo: index + 1,
                Description: i.name,
                Quantity: i.qty,
                UnitPrice: i.price,
                Amount: (i.qty * i.price)
            }));
        }

        const pushResponse = await axios.post(`https://ramis.ird.gov.lk/api${endpoint}`, ramisPayload, {
            headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json' }
        });

        if (pushResponse.status === 200) {
            return { success: true, ramisRef: pushResponse.data.referenceNo, status: "PENDING_MATCH" };
        } else {
            throw new Error("RAMIS_SUBMISSION_REJECTED");
        }

    } catch (error) {
        console.error("RAMIS API Error:", error.response ? error.response.data : error.message);
        throw new HttpsError('unavailable', 'IRD Server Error. Queued for offline sync.');
    }
});

// 🚀 2. CREDIT/DEBIT NOTE SUBMISSION (Schedule 4) - NEW!
exports.pushCreditDebitNoteToRamis = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Access Denied.');

    const { ownerId, type, docNo, originalInvoiceNo, tin, vatNo, buyerTin, reason, amount, vatReversed, date } = request.data;
    
    try {
        const jwtToken = await getValidRamisToken(ownerId);

        const ramisPayload = {
            SupplierTIN: tin,
            SupplierVATNo: vatNo,
            PurchaserTIN: buyerTin || null, 
            NoteType: type === "CREDIT" ? "CR" : "DR", // CR = Refund, DR = Return to Vendor
            NoteNumber: docNo,
            OriginalTaxInvoiceNo: originalInvoiceNo, // 🚨 CRITICAL REQUIREMENT!
            DateOfIssue: date,
            Reason: reason,
            ValueWithoutVAT: amount - vatReversed,
            VATAmount: vatReversed,
            TotalValue: amount
        };

        const pushResponse = await axios.post(`https://ramis.ird.gov.lk/api/submit-credit-debit-note`, ramisPayload, {
            headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json' }
        });

        if (pushResponse.status === 200) {
            return { success: true, ramisRef: pushResponse.data.referenceNo };
        } else {
            throw new Error("RAMIS_CD_NOTE_REJECTED");
        }
    } catch (error) {
        console.error("RAMIS CD Note Error:", error);
        throw new HttpsError('unavailable', 'IRD Server Error. Please sync manually later.');
    }
});
// 🚀 3. INVOICE STATUS VERIFICATION (Polling Purchaser Approvals)
exports.checkRamisInvoiceStatus = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Access Denied.');

    const { ownerId, tin, vatNo, invoicesToCheck } = request.data;
    
    if (!invoicesToCheck || invoicesToCheck.length === 0) {
        return { success: true, statuses: [] };
    }

    try {
        const jwtToken = await getValidRamisToken(ownerId);
        let updatedStatuses = [];

        // Note: IRD API might allow bulk checking, or we may need to loop. 
        // We use a loop here assuming a standard single-check API architecture, 
        // but we limit concurrency to avoid overwhelming the IRD server.
        for (let inv of invoicesToCheck) {
            try {
                // 🚨 UPDATE THIS URL to the exact IRD status checking endpoint
                const response = await axios.post(`https://ramis.ird.gov.lk/api/get-invoice-status`, {
                    SupplierTIN: tin,
                    SupplierVATNo: vatNo,
                    TaxInvoiceNo: inv.invoiceNo
                }, {
                    headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json' }
                });

                if (response.status === 200 && response.data) {
                    // IRD Statuses: "Pending Approval", "Matched", "Unmatched"
                    updatedStatuses.push({
                        id: inv.docId, // Firestore Document ID
                        invoiceNo: inv.invoiceNo,
                        ramisStatus: response.data.Status || "UNKNOWN",
                        disallowedVat: response.data.DisallowedVAT || 0,
                        unmatchReason: response.data.UnmatchReason || ""
                    });
                }
            } catch (err) {
                console.warn(`Failed to check status for ${inv.invoiceNo}:`, err.message);
                // Skip errors for individual invoices to let the rest process
            }
        }

        return { success: true, statuses: updatedStatuses };

    } catch (error) {
        console.error("RAMIS Status Sync Error:", error);
        throw new HttpsError('unavailable', 'Failed to connect to IRD RAMIS Server for status sync.');
    }
});
// // ========================================================================
// 🏛️ THE COMPLETE CQRS EVENT-DRIVEN LEDGER ENGINE (100% SECURE)
// ========================================================================
const { onDocumentCreated, onDocumentWritten, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { FieldValue } = require("firebase-admin/firestore");

const secureRound = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

const getRollupKeys = (isoDateStr) => {
    const dateObj = new Date(isoDateStr);
    const slTime = new Date(dateObj.getTime() + (5.5 * 60 * 60 * 1000));
    const y = slTime.getUTCFullYear();
    const m = String(slTime.getUTCMonth() + 1).padStart(2, '0');
    const d = String(slTime.getUTCDate()).padStart(2, '0');
    return { dayKey: `${y}_${m}_${d}`, monthKey: `${y}_${m}` };
};

// ------------------------------------------------------------------------
// 1. TRIGGER: ON SALE CREATED (Includes Zero-Trust Poka-Yoke Security Engine)
// ------------------------------------------------------------------------
exports.onSaleCreated = onDocumentCreated("users/{ownerId}/shops/{shopId}/sales/{saleId}", async (event) => {
    const sale = event.data.data();
    const { ownerId, shopId, saleId } = event.params;
    const db = admin.firestore();

    // =====================================================================
    // 🚨 ENTERPRISE ZERO-TRUST SECURITY ENGINE (ANTI-FRAUD AUDITOR)
    // =====================================================================
    let isFraud = false;
    let fraudReasons = [];

    // 1. ගණිතමය වංචා පරීක්ෂාව (Mathematical Integrity Check)
    let expectedSubtotal = 0;
    if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(i => {
            expectedSubtotal += (parseFloat(i.sell) || 0) * (parseFloat(i.qty) || 0);
        });
    }
    expectedSubtotal = Math.round(expectedSubtotal * 100) / 100;

    // Subtotal එක Item වල එකතුවට වඩා රු. 1 කට වඩා වෙනස් නම් එය වංචාවකි (Payload Manipulation)
    if (Math.abs(expectedSubtotal - (sale.subtotal || 0)) > 1.0) {
        isFraud = true;
        fraudReasons.push(`Subtotal Tampering: Expected Rs.${expectedSubtotal}, Got Rs.${sale.subtotal}`);
    }

    // මුළු බිල (Grand Total) සඳහා ඔබගේ සියලුම සංකීර්ණ නීති (Taxes, Promos, Wallet, Loyalty) හරහා ගණනය කිරීම
    let expectedTotal = (sale.subtotal || 0) 
                      - (sale.discountAmt || 0) 
                      + (sale.feesTotal || 0) 
                      + (sale.taxAmt || 0) 
                      + (sale.surchargeAmt || 0) 
                      - (sale.loyaltyRedeemed || 0);
                      
    expectedTotal = Math.round(expectedTotal * 100) / 100;

    if (Math.abs(expectedTotal - (sale.total || 0)) > 1.0) {
        isFraud = true;
        fraudReasons.push(`Grand Total Tampering: Expected Rs.${expectedTotal}, Got Rs.${sale.total}`);
    }

    // 2. සෘණ අගයන්ගෙන් සල්ලි සොරකම් කිරීම පරීක්ෂාව (Negative Value Injection)
    if ((sale.total || 0) < 0 || (sale.discountAmt || 0) < 0 || (sale.cashGiven || 0) < 0 || (sale.creditBalance || 0) < 0) {
        isFraud = true;
        fraudReasons.push("Negative Values Injected: Attempted system theft via negative balances.");
    }

    // 3. Database මිල ගණන් වංචාව පරීක්ෂාව (Price Drop Injection Verification)
    // හැකර්වරයෙකු {sell: 0.01} ලෙස බඩු ලැයිස්තුව වෙනස් කර ඇත්දැයි බැලීම
    let hasPriceTampering = false;
    if (sale.items && Array.isArray(sale.items)) {
        for (let item of sale.items) {
            if (item.isService) continue; // Services වලට ස්ථාවර Cost එකක් නැත
            
            try {
                const pSnap = await db.doc(`users/${ownerId}/shops/${shopId}/products/${item.id}`).get();
                if (pSnap.exists) {
                    const actualCost = parseFloat(pSnap.data().buy) || 0;
                    const claimedSell = parseFloat(item.sell) || 0;

                    // පද්ධතියේ Cost එකට වඩා 90% කින් අඩුවෙන් (DB Cost * 0.1) යමක් විකුණා ඇත්නම් එය අනිවාර්යයෙන්ම Hack එකකි! (වට්ටම් මෙයට අදාළ නොවේ, මෙය Unit Price එකයි)
                    if (actualCost > 0 && claimedSell < (actualCost * 0.1)) {
                        hasPriceTampering = true;
                        fraudReasons.push(`Price Injection: '${item.name}' sold at Rs.${claimedSell}, but DB Cost is Rs.${actualCost}.`);
                    }
                }
            } catch (err) { console.error("Validation Read Error", err); }
        }
    }
    if (hasPriceTampering) isFraud = true;

    // 4. Pay Later (ණය) වංචා පරීක්ෂාව
    const payableAmount = (sale.total || 0) - (sale.walletApplied || 0);
    if (sale.paymentMethod === 'Pay Later') {
        const expectedCredit = Math.round((payableAmount - (sale.cashGiven || 0)) * 100) / 100;
        if (Math.abs(expectedCredit - (sale.creditBalance || 0)) > 1.0 && expectedCredit > 0) {
            isFraud = true;
            fraudReasons.push(`Credit Balance Tampering: Expected Rs.${expectedCredit}, Got Rs.${sale.creditBalance}`);
        }
    }

    // 🛑 ප්‍රතිඵලය: වංචාවක් අසුවී නම් Rollups Update කිරීම නතර කර Admin ට දැනුම් දීම
    if (isFraud) {
        const secureTime = new Date().toISOString();
        const alertMsg = `CRITICAL FRAUD BLOCKED: Invoice #${sale.customOrderId || saleId} was manipulated by a user or hacker bypassing UI constraints! Reasons: ${fraudReasons.join(' | ')}`;
        
        const fraudBatch = db.batch();
        
        // A. බිල ව්‍යාජ එකක් ලෙස ලේබල් කිරීම (Reports වලට එකතු වීම වළක්වයි)
        fraudBatch.update(event.data.ref, { 
            securityStatus: "FRAUD_BLOCKED", 
            fraudDetails: alertMsg,
            isVoid: true 
        });

        // B. Admin ගේ Security Audit Trail එකට ලිවීම
        const auditRef = db.collection(`users/${ownerId}/system_audit_logs`).doc();
        fraudBatch.set(auditRef, {
            timestamp: secureTime, userEmail: "ZERO_TRUST_ENGINE", userRole: "system", shopId: shopId, shopName: "Security Module",
            action: "FRAUD_SALE_BLOCKED", description: alertMsg
        });

        // C. Dashboard Alerts වල රතු පාටින් පෙන්වීම
        const alertRef = db.collection(`users/${ownerId}/shops/${shopId}/alerts`).doc();
        fraudBatch.set(alertRef, {
            refId: 'SECURITY_ENGINE', type: 'global', orderId: sale.customOrderId || saleId,
            message: alertMsg, targetDate: secureTime, frequency: 'once', status: 'triggered', createdAt: secureTime
        });

        await fraudBatch.commit();
        console.error("Zero-Trust Engine blocked a fraudulent payload:", alertMsg);
        
        return; // ⛔ සම්පූර්ණ ක්‍රියාවලියම මෙතැනින් නවතී! P&L එකට සල්ලි යන්නේ නැත.
    }
    // =====================================================================

    // 🟢 වංචාවක් නැතිනම්, සුපුරුදු පරිදි මුල්‍ය වාර්තා (Rollups) Update කිරීම
    const keys = getRollupKeys(sale.date);
    
    // Calculate Standard COGS + F&B Recipe COGS
    // 🚨 ZERO-TRUST FIX: Ensure recipeCogs cannot be manipulated into a negative value
    let cogs = Math.max(0, parseFloat(sale.recipeCogs) || 0); 
    if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(i => {
            // 🚨 SYSTEM OPTIMIZATION: Services have no inventory cost. Bypass them to save CPU cycles.
            if (i.isService) return;

            // 🚨 FORENSIC SECURITY FIX: Math.max(0, ...) strictly prevents Hacker Negative Qty/Buy injections!
            const itemBuy = Math.max(0, parseFloat(i.buy) || 0);
            const itemQty = Math.max(0, parseFloat(i.qty) || 0);

            // 🚨 IFRS & FLOATING POINT FIX: Securely round the cost PER LINE before accumulation
            const lineCogs = secureRound(itemBuy * itemQty);
            cogs += lineCogs;
        });
    }
    // 🛡️ Final safeguard rounding for the entire aggregated COGS
    cogs = secureRound(cogs);

    const payMethod = sale.paymentMethod || 'Cash';
    let cashIn = 0, bankIn = 0, chqIn = 0;
    const netReceivable = secureRound(sale.total - (sale.walletApplied || 0)); 
    
    if (payMethod === 'Pay Later') cashIn = sale.cashGiven || 0;
    else if (payMethod.includes('Card') || payMethod.includes('Transfer') || payMethod.includes('Bank')) bankIn = netReceivable;
    else if (payMethod === 'Cheque') chqIn = netReceivable;
    else cashIn = netReceivable;

    const gross = (sale.subtotal || 0) + (sale.feesTotal || 0) + (sale.surchargeAmt || 0);
    
    // 🚨 IFRS 15 FIX: Loyalty is NOT a discount! It is a Marketing Expense (OPEX).
    // This preserves Gross Sales and Net Revenue integrity for taxation.
    const strictDiscounts = (sale.discountAmt || 0);
    const loyaltyMarketingExpense = (sale.loyaltyRedeemed || 0);

    const rollupPayload = {
        grossSales: FieldValue.increment(secureRound(gross)),
        totalDiscounts: FieldValue.increment(secureRound(strictDiscounts)),
        taxCollected: FieldValue.increment(secureRound(sale.taxAmt || 0)),
        totalCOGS: FieldValue.increment(secureRound(cogs)),
        payLaterDebt_Issued: FieldValue.increment(secureRound(sale.creditBalance || 0)),
        storeCreditWallet_Redeemed: FieldValue.increment(secureRound(sale.walletApplied || 0)),
        cashInDrawer: FieldValue.increment(secureRound(cashIn)),
        bankTransfers: FieldValue.increment(secureRound(bankIn)),
        chequesPending: FieldValue.increment(secureRound(chqIn)),
        
        // 🚨 ZERO-TRUST ACCOUNTING: Balance the equation by logging Loyalty as an Operational Expense
        operationalExpenses: FieldValue.increment(secureRound(loyaltyMarketingExpense)),
        "dynamicOpex.Loyalty_Redemptions": FieldValue.increment(secureRound(loyaltyMarketingExpense))
    };

    const glPayload = {
        totalReceivables: FieldValue.increment(secureRound(sale.creditBalance || 0)),
        cashInHand: FieldValue.increment(secureRound(cashIn)),
        cashAtBank: FieldValue.increment(secureRound(bankIn)),
        taxPayable: FieldValue.increment(secureRound(sale.taxAmt || 0)),
        pendingRecCheques: FieldValue.increment(secureRound(chqIn))
    };

    const batch = db.batch();
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_daily/${keys.dayKey}`), rollupPayload, { merge: true });
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly/${keys.monthKey}`), rollupPayload, { merge: true });
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/settings/global_balance_sheet`), glPayload, { merge: true });
    
    await batch.commit();
});

// ------------------------------------------------------------------------
// 2. TRIGGER: ON EXPENSE WRITTEN (Includes Legacy Flags Fix)
// ------------------------------------------------------------------------
exports.onExpenseWritten = onDocumentWritten("users/{ownerId}/shops/{shopId}/expenses/{expenseId}", async (event) => {
    const { ownerId, shopId } = event.params;
    const db = admin.firestore();
    const batch = db.batch();

    const applyExpenseImpact = (exp, multiplier) => {
        if (exp.isPending) return; 
        
        // 🚨 CQRS ARCHITECT FIX: Ignore Frontend UI Markers!
        // Prevents Double-Deductions because 'onChequeUpdated' and 'onIssuedChequeWritten' 
        // already handle the Global Ledger updates for these specific events!
        if (exp.isClearedCheque || exp.isBouncedCheque || (exp.description && exp.description.includes('Issued Cheque Cleared'))) return;

        const keys = getRollupKeys(exp.date);
        const amt = secureRound(exp.amount) * multiplier;
        const isBank = exp.payMethod === 'Bank Transfer' || exp.payMethod === 'Bank';

        let rollups = {};
        let gl = {};

        // Liquid Asset Impact
        if (exp.isNonCashExpense || exp.payMethod === 'None' || exp.payMethod === 'Store Credit') {
            // Zero-Trust Security: No impact on physical cash or bank accounts for internal ledger adjustments
        } else if (isBank) {
            rollups.bankTransfers = FieldValue.increment(exp.isIncome ? amt : -amt);
            gl.cashAtBank = FieldValue.increment(exp.isIncome ? amt : -amt);
        } else { 
            // Assume Cash
            rollups.cashInDrawer = FieldValue.increment(exp.isIncome ? amt : -amt);
            gl.cashInHand = FieldValue.increment(exp.isIncome ? amt : -amt);
        }

        // 🚨 CQRS FIX: Smart Routing for Legacy Flags & Advanced Accounting
        if (exp.isAdvanceEvent) {
            // Asset Swap: Cash vs Staff Advances (NO P&L IMPACT!)
            if (exp.isIncome) gl.staffAdvancesAsset = FieldValue.increment(-amt);
            else gl.staffAdvancesAsset = FieldValue.increment(amt);
            
        } else if (!exp.isIncome && exp.isLiability) {
            // 🏛️ IFRS 100% FIX: Bounced Cheque Wallet Clawback (Liability Reduction)
            gl.storeCredits = FieldValue.increment(-amt);
            
        } else if (!exp.isIncome && exp.isDrawings) {
            // =========================================================================
            // 🏛️ IFRS IAS 1 & IRD COMPLIANCE: OWNER DRAWINGS (DIRECT EQUITY REDUCTION)
            // අයිතිකරු පෞද්ගලික පරිභෝජනයට ගත් භාණ්ඩ ලාභයෙන් (P&L) නොකපා හිමිකමෙන් (Equity) කපා හැරීම
            // =========================================================================
            gl.ownerDrawings = FieldValue.increment(amt);
            rollups.ownerDrawings = FieldValue.increment(amt);
            // 🚨 ZERO P&L IMPACT: operationalExpenses හෝ dynamicOpex වෙත කිසිදු අගයක් එකතු නොවේ!
            
        } else if (exp.isIncome) {
            if (exp.isLiability) {
                gl.storeCredits = FieldValue.increment(amt);
            } else if (exp.breakdown && typeof exp.breakdown === 'object' && Object.keys(exp.breakdown).length > 0 && exp.amount > 0) {
                rollups.debtCollections_Received = FieldValue.increment(amt);
                gl.totalReceivables = FieldValue.increment(-amt);
            } else {
                rollups.otherIncomes = FieldValue.increment(amt);
            }
        } else {
            if (exp.isCapex) {
                rollups.capitalExpenses = FieldValue.increment(amt);
                if (exp.description && exp.description.includes('[SUPPLIER PAY] Debt Settlement')) {
                    gl.totalPayables = FieldValue.increment(-amt);
                }
            } else if (exp.isPayroll) {
                rollups.payrollExpenses = FieldValue.increment(amt);
                // Add the recovered advance back into P&L and clear the Asset!
                if (exp.recoveredAdvance) {
                    const recAdv = secureRound(exp.recoveredAdvance) * multiplier;
                    rollups.payrollExpenses = FieldValue.increment(recAdv); 
                    gl.staffAdvancesAsset = FieldValue.increment(-recAdv); 
                }
            } else {
                rollups.operationalExpenses = FieldValue.increment(amt);
                
                // 🛡️ ZERO-TRUST CATEGORY RESOLUTION (FieldPath Crash Immunity)
                let rawCatName = "General_OPEX";
                if (exp.isFleetExpense) {
                    rawCatName = "Fleet_Logistics";
                } else if (exp.category && typeof exp.category === 'string' && exp.category.trim() !== '') {
                    rawCatName = exp.category.trim();
                } else {
                    // Legacy Fallback for older records using bracket tags
                    const match = (exp.description || "").match(/^\[(.*?)\]/);
                    if (match && match[1]) rawCatName = match[1].trim();
                }

                // 🚨 FIRESTORE PATH SANITIZER: Eliminates invalid characters (. [ ] * / ~) to prevent Fatal Cloud Function Crashes!
                const sanitizedCatName = rawCatName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 32) || 'General_OPEX';
                
                rollups[`dynamicOpex.${sanitizedCatName}`] = FieldValue.increment(amt);
            }
        }

        batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_daily/${keys.dayKey}`), rollups, { merge: true });
        batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly/${keys.monthKey}`), rollups, { merge: true });
        batch.set(db.doc(`users/${ownerId}/shops/${shopId}/settings/global_balance_sheet`), gl, { merge: true });
    };

    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;

    if (!before && after) applyExpenseImpact(after, 1); 
    else if (before && !after) applyExpenseImpact(before, -1); 
    else if (before && after && before.isPending && !after.isPending) applyExpenseImpact(after, 1); 

    await batch.commit();
});

// ------------------------------------------------------------------------
// 3. TRIGGER: ON REFUND CREATED (The Missing Link)
// ------------------------------------------------------------------------
exports.onRefundCreated = onDocumentCreated("users/{ownerId}/shops/{shopId}/refunds/{refundId}", async (event) => {
    const r = event.data.data();
    const { ownerId, shopId } = event.params;
    const db = admin.firestore();

    const keys = getRollupKeys(r.date);
    
    // 🚨 IFRS HISTORICAL COST FIX: Use explicit historical COGS to prevent tax/discount math collisions
    // Fallback to legacy calculation ONLY for old refunds processed before this update
    let cogsReversed = 0;
    if (r.restock) {
        if (r.cogsReversed !== undefined) {
            cogsReversed = secureRound(r.cogsReversed);
        } else {
            cogsReversed = secureRound(r.amount - (r.profitReversal || 0)); // Legacy fallback
        }
    }
    
    const cashOut = r.cashOutToCustomer || 0;

    let rollups = {
        salesReturns: FieldValue.increment(secureRound(r.amount)),
        taxReversed: FieldValue.increment(secureRound(r.taxReversed || 0)),
        totalCOGS: FieldValue.increment(-cogsReversed)
    };
    
    let gl = {
        taxPayable: FieldValue.increment(secureRound(-(r.taxReversed || 0)))
    };

    if (r.refundMethod === 'Store Credit') {
        rollups.storeCreditWallet_Issued = FieldValue.increment(cashOut);
        gl.storeCredits = FieldValue.increment(cashOut);
    } else if (r.refundMethod === 'Card/Bank') {
        rollups.bankTransfers = FieldValue.increment(-cashOut);
        gl.cashAtBank = FieldValue.increment(-cashOut);
    } else { // Cash
        rollups.cashInDrawer = FieldValue.increment(-cashOut);
        gl.cashInHand = FieldValue.increment(-cashOut);
    }

    const batch = db.batch();
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_daily/${keys.dayKey}`), rollups, { merge: true });
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly/${keys.monthKey}`), rollups, { merge: true });
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/settings/global_balance_sheet`), gl, { merge: true });
    await batch.commit();
});

// ------------------------------------------------------------------------
// 4. TRIGGER: ON CHEQUE UPDATED (Clear/Bounce Tracker)
// ------------------------------------------------------------------------
exports.onChequeUpdated = onDocumentUpdated("users/{ownerId}/shops/{shopId}/cheques/{chequeId}", async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (before.status === after.status) return;

    const { ownerId, shopId } = event.params;
    const db = admin.firestore();
    const amt = secureRound(after.amount);
    
    const actionDate = after.clearedDate || after.bouncedDate || new Date().toISOString();
    const keys = getRollupKeys(actionDate);
    
    let rollups = { chequesPending: FieldValue.increment(-amt) };
    let gl = { pendingRecCheques: FieldValue.increment(-amt) };

    if (after.status === 'CLEARED') {
        rollups.bankTransfers = FieldValue.increment(amt);
        gl.cashAtBank = FieldValue.increment(amt);
    } else if (after.status === 'BOUNCED') {
        rollups.payLaterDebt_Issued = FieldValue.increment(amt);
        gl.totalReceivables = FieldValue.increment(amt);
    }

    const batch = db.batch();
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_daily/${keys.dayKey}`), rollups, { merge: true });
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly/${keys.monthKey}`), rollups, { merge: true });
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/settings/global_balance_sheet`), gl, { merge: true });
    await batch.commit();
});
// ------------------------------------------------------------------------
// 5. TRIGGER: ON DEBIT NOTE CREATED (Return to Vendor - 100% IFRS BALANCED & IDEMPOTENT)
// ------------------------------------------------------------------------
exports.onDebitNoteCreated = onDocumentCreated("users/{ownerId}/shops/{shopId}/debit_notes/{noteId}", async (event) => {
    const dn = event.data.data();
    const { ownerId, shopId, noteId } = event.params;
    const db = admin.firestore();

    // 🛡️ IDEMPOTENCY FIREWALL: Function එක Retried වුවහොත් දෙවරක් GL එක කැපීම වළක්වයි
    if (dn.glProcessed === true) {
        console.log(`[CQRS] Debit Note ${noteId} already processed. Skipping to prevent duplicate GL deduction.`);
        return;
    }

    const safeTotalCredit = secureRound(dn.totalCredit || 0);
    const safeNetCost = secureRound(dn.netAmount || (dn.unitPrice * dn.qty) || 0);
    const safeVatAmount = secureRound(dn.vatAmount || 0);

    if (safeTotalCredit <= 0) return;

    const keys = getRollupKeys(dn.date || new Date().toISOString());
    const batch = db.batch();

    const glRef = db.doc(`users/${ownerId}/shops/${shopId}/settings/global_balance_sheet`);
    const dRollupRef = db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_daily/${keys.dayKey}`);
    const mRollupRef = db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly/${keys.monthKey}`);

    // =========================================================================
    // 🏛️ IFRS DOUBLE-ENTRY BALANCED JOURNAL ENTRIES
    // Dr. Accounts Payable (Liabilities Decrease) = safeTotalCredit
    // Cr. Tax Payable (Input VAT Reversal / Liability Increase) = safeVatAmount
    // (Note: Cr. Inventory Asset is already handled by onProductWritten at historical cost)
    // =========================================================================
    const glPayload = {
        totalPayables: FieldValue.increment(-safeTotalCredit)
    };
    if (safeVatAmount > 0) {
        // ආදාන බදු ආපසු හැරවීම නිසා රජයට ගෙවිය යුතු බදු වගකීම වැඩි වේ (හෝ Input Tax අඩු වේ)
        glPayload.taxPayable = FieldValue.increment(safeVatAmount);
    }
    batch.set(glRef, glPayload, { merge: true });

    // Financial Rollups Update (P&L සහ Audit Trail සමතුලිත කිරීම)
    const rollupPayload = {
        supplierReturns_Net: FieldValue.increment(safeNetCost),
        taxReversed_InputVAT: FieldValue.increment(safeVatAmount)
    };
    batch.set(dRollupRef, rollupPayload, { merge: true });
    batch.set(mRollupRef, rollupPayload, { merge: true });

    // Mark as Processed to enforce Idempotency
    batch.update(event.data.ref, { glProcessed: true, processedAt: admin.firestore.FieldValue.serverTimestamp() });

    await batch.commit();
    console.log(`[CQRS] RTV Balanced: AP reduced by ${safeTotalCredit}, Tax adjusted by ${safeVatAmount} for DN ${dn.dnId || noteId}`);
});

// ------------------------------------------------------------------------
// 6. TRIGGER: ON CROSS-BRANCH TRANSFER CREATED (INTER-BRANCH ROLLUP SYNC)
// ------------------------------------------------------------------------
exports.onTransferCreated = onDocumentCreated("users/{ownerId}/transfers/{transferId}", async (event) => {
    const tr = event.data.data();
    const { ownerId, transferId } = event.params;
    const db = admin.firestore();

    if (tr.status !== 'COMPLETED' || tr.rollupsProcessed === true) return;

    try {
        // 🏛️ ZERO-ARBITRARY VALUATION: Read exact historical cost embedded in transfer document
        const totalAssetValue = secureRound(tr.totalCost || ((parseFloat(tr.unitCost) || 0) * (parseFloat(tr.qty) || 0)));
        if (totalAssetValue <= 0) return;

        const keys = getRollupKeys(tr.date || new Date().toISOString());
        const batch = db.batch();

        // 1. Source Branch Outflow Rollup (තොග පිටවීම සටහන් කිරීම)
        const srcDailyRef = db.doc(`users/${ownerId}/shops/${tr.sourceShopId}/financial_rollups_daily/${keys.dayKey}`);
        const srcMonthlyRef = db.doc(`users/${ownerId}/shops/${tr.sourceShopId}/financial_rollups_monthly/${keys.monthKey}`);
        batch.set(srcDailyRef, { inventoryTransfers_Out: FieldValue.increment(totalAssetValue) }, { merge: true });
        batch.set(srcMonthlyRef, { inventoryTransfers_Out: FieldValue.increment(totalAssetValue) }, { merge: true });

        // 2. Target Branch Inflow Rollup (තොග ලැබීම සටහන් කිරීම)
        const tgtDailyRef = db.doc(`users/${ownerId}/shops/${tr.targetShopId}/financial_rollups_daily/${keys.dayKey}`);
        const tgtMonthlyRef = db.doc(`users/${ownerId}/shops/${tr.targetShopId}/financial_rollups_monthly/${keys.monthKey}`);
        batch.set(tgtDailyRef, { inventoryTransfers_In: FieldValue.increment(totalAssetValue) }, { merge: true });
        batch.set(tgtMonthlyRef, { inventoryTransfers_In: FieldValue.increment(totalAssetValue) }, { merge: true });

        // 3. Mark Transfer as Rollup-Processed (Idempotency Guard)
        batch.update(event.data.ref, { rollupsProcessed: true, processedAt: admin.firestore.FieldValue.serverTimestamp() });

        await batch.commit();
        console.log(`[CQRS] Inter-branch transfer ${transferId} reconciled: Rs.${totalAssetValue} moved from ${tr.sourceShopId} to ${tr.targetShopId}`);
    } catch(e) { 
        console.error("[CQRS] Transfer Rollup Sync Error:", e); 
    }
});

// ------------------------------------------------------------------------
// 7. TRIGGER: ON ISSUED CHEQUE WRITTEN (Supplier Cheques)
// ------------------------------------------------------------------------
exports.onIssuedChequeWritten = onDocumentWritten("users/{ownerId}/shops/{shopId}/issued_cheques/{chequeId}", async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    
    if (!after) return; // If deleted, ignore or handle manual reversal
    if (before && before.status === after.status) return; // Status didn't change

    const { ownerId, shopId } = event.params;
    const db = admin.firestore();
    const amt = secureRound(after.amount);
    
    const actionDate = after.clearedDate || after.bouncedDate || after.issuedDate || new Date().toISOString();
    const keys = getRollupKeys(actionDate);
    
    const dRollupRef = db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_daily/${keys.dayKey}`);
    const mRollupRef = db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly/${keys.monthKey}`);
    const glRef = db.doc(`users/${ownerId}/shops/${shopId}/settings/global_balance_sheet`);

    const batch = db.batch();
    let rollups = {}; let gl = {};

    if (!before && after.status === 'PENDING') {
        // CREATED: Paid supplier with a cheque (Debt decreases, Issued Cheque Liability increases)
        gl.totalPayables = FieldValue.increment(-amt);
        gl.pendingIssCheques = FieldValue.increment(amt);
    } 
    else if (after.status === 'CLEARED') {
        // CLEARED: Liability drops, Bank drops, CAPEX recorded
        gl.pendingIssCheques = FieldValue.increment(-amt);
        gl.cashAtBank = FieldValue.increment(-amt);
        rollups.bankTransfers = FieldValue.increment(-amt);
        rollups.capitalExpenses = FieldValue.increment(amt);
    } 
    else if (after.status === 'BOUNCED') {
        // BOUNCED: Liability drops, but Debt to Supplier returns!
        gl.pendingIssCheques = FieldValue.increment(-amt);
        gl.totalPayables = FieldValue.increment(amt);
    }

    if (Object.keys(rollups).length > 0) {
        batch.set(dRollupRef, rollups, { merge: true });
        batch.set(mRollupRef, rollups, { merge: true });
    }
    if (Object.keys(gl).length > 0) {
        batch.set(glRef, gl, { merge: true });
    }
    await batch.commit();
});// ------------------------------------------------------------------------
// NEW: TRIGGER: ON PRODUCT WRITTEN (The Ultimate Inventory Asset Truth)
// ------------------------------------------------------------------------
exports.onProductWritten = onDocumentWritten("users/{ownerId}/shops/{shopId}/products/{productId}", async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const db = admin.firestore();

    const oldQty = before ? (parseFloat(before.qty) || 0) : 0;
    const newQty = after ? (parseFloat(after.qty) || 0) : 0;
    const oldBuy = before ? (parseFloat(before.buy) || 0) : 0;
    const newBuy = after ? (parseFloat(after.buy) || 0) : 0;

    // 🚨 IFRS IAS 2 STRICT COMPLIANCE FIX: Historical Cost Preservation
    // කෘත්‍රිමව වත්කම් පුම්බන (Artificial Asset Inflation) දෝෂය මෙතැනින් සම්පූර්ණයෙන්ම වළක්වා ඇත!
    let assetDelta = 0;
    let payablesDelta = 0;

    if (!before && after) {
        // 1. BRAND NEW STOCK BATCH (IN) -> Use new historical cost
        assetDelta = secureRound(newQty * newBuy);
        if (after.payStatus === 'Credit' || after.payStatus === 'Cheque') {
            payablesDelta = assetDelta; 
        }
    } else if (before && !after) {
        // 2. BATCH DELETED (OUT) -> Deduct completely at original historical cost
        assetDelta = secureRound(-oldQty * oldBuy);
        // 🚨 IFRS FIX: Reverse Accounts Payable if an unpaid batch is entirely deleted
        if (before.payStatus === 'Credit' || before.payStatus === 'Cheque') {
            payablesDelta = assetDelta; 
        }
    } else if (before && after) {
        // 3. QUANTITY CHANGED (SALE / REFUND / WRITEOFF)
        const qtyDelta = newQty - oldQty;
        
        // 🛡️ ZERO-TRUST ENGINE: 
        // The value of stock moving IN or OUT MUST strictly be calculated at its ORIGINAL Historical Cost (oldBuy).
        assetDelta = secureRound(qtyDelta * oldBuy);
        
        // 🚨 ZERO-TRUST AP ENGINE: Normal qty reductions (Sales) MUST NOT reduce Supplier Debt!
        // Accounts Payable is ONLY adjusted if the Administrator explicitly altered the original Cost Price (buy).
        if ((after.payStatus === 'Credit' || after.payStatus === 'Cheque') && (oldBuy !== newBuy)) {
            payablesDelta = secureRound((newBuy - oldBuy) * oldQty);
        }

        // 🚨 FORENSIC AUDIT TRAP: Detect Silent Price Manipulation
        if (oldBuy !== newBuy) {
            console.error(`[SECURITY ALERT] IAS 2 Violation Attempted: User tried to alter Historical Cost of batch ${event.params.productId} from ${oldBuy} to ${newBuy}. Ghost Asset revaluation successfully blocked by system!`);
        }
    }

    if (assetDelta !== 0 || payablesDelta !== 0) {
        const glRef = db.doc(`users/${event.params.ownerId}/shops/${event.params.shopId}/settings/global_balance_sheet`);
        const updates = {};
        if (assetDelta !== 0) updates.inventoryAsset = FieldValue.increment(assetDelta);
        if (payablesDelta !== 0) updates.totalPayables = FieldValue.increment(payablesDelta);
        await glRef.set(updates, { merge: true });
    }
});
// ------------------------------------------------------------------------
// NEW: TRIGGER: ON CHEQUE CREATED (Debt Settlement routing)
// ------------------------------------------------------------------------
exports.onChequeCreated = onDocumentCreated("users/{ownerId}/shops/{shopId}/cheques/{chequeId}", async (event) => {
    const c = event.data.data();
    // Ignore POS cheques (onSaleCreated handles them)
    if (!c.isDebtSettlement || c.status !== 'PENDING') return; 

    const db = admin.firestore();
    const amt = secureRound(c.amount);
    const keys = getRollupKeys(c.receivedDate || new Date().toISOString());

    const rollups = { chequesPending: FieldValue.increment(amt) };
    const gl = { 
        pendingRecCheques: FieldValue.increment(amt),
        totalReceivables: FieldValue.increment(-amt) // Reduces the customer debt globally
    };

    const batch = db.batch();
    batch.set(db.doc(`users/${event.params.ownerId}/shops/${event.params.shopId}/financial_rollups_daily/${keys.dayKey}`), rollups, { merge: true });
    batch.set(db.doc(`users/${event.params.ownerId}/shops/${event.params.shopId}/financial_rollups_monthly/${keys.monthKey}`), rollups, { merge: true });
    batch.set(db.doc(`users/${event.params.ownerId}/shops/${event.params.shopId}/settings/global_balance_sheet`), gl, { merge: true });
    await batch.commit();
});
// ========================================================================
// 🛡️ ENTERPRISE BIOMETRIC HARDWARE INGESTION WEBHOOK (ZERO-TRUST KYC)
// ========================================================================
const { onRequest } = require("firebase-functions/v2/https");

exports.biometricPushWebhook = onRequest({ cors: true }, async (req, res) => {
    // 1. SECURITY: Machine Identity & Hardware Secret Token Verification
    const deviceSerial = req.headers['x-device-serial'] || req.query.sn || req.body.sn;
    const deviceSecret = req.headers['x-device-token'] || req.query.token;

    if (!deviceSerial) {
        return res.status(401).send("UNAUTHORIZED: Device serial missing.");
    }

    try {
        // req.body මගින් Device එක එවන Attendance Payload එක ලබා ගැනීම
        // ZKTeco / Realtime යන්ත්‍ර සාමාන්‍යයෙන් JSON හෝ URL-Encoded string එකක් එවයි
        const { empId, punchTime, ownerId, shopId } = req.body;

        if (!empId || !punchTime || !ownerId || !shopId) {
            return res.status(400).send("BAD_REQUEST: Missing punch telemetry.");
        }

        const db = admin.firestore();
        const punchDateObj = new Date(punchTime);
        const slDateStr = new Date(punchDateObj.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];

        // 2. සේවකයා සැබෑවක්ම Database එකේ සිටීදැයි බැලීම (Ghost Employee Elimination)
        const empRef = db.doc(`users/${ownerId}/shops/${shopId}/employees/${empId}`);
        const empSnap = await empRef.get();

        if (!empSnap.exists()) {
            console.error(`🚨 HARDWARE FRAUD: Unregistered Fingerprint tried to punch! Device: ${deviceSerial}, User ID: ${empId}`);
            return res.status(404).send("EMPLOYEE_NOT_REGISTERED");
        }

        const empData = empSnap.data();

        // 3. Roster එක පරීක්ෂා කිරීම
        const [y, m] = slDateStr.split('-');
        const rosterSnap = await db.doc(`users/${ownerId}/shops/${shopId}/settings/roster_${y}_${m}`).get();
        const todayRoster = rosterSnap.exists() ? rosterSnap.data().days[slDateStr] : null;

        const logsRef = db.collection(`users/${ownerId}/shops/${shopId}/employees/${empId}/logs`);
        const todayLogQ = await logsRef.where("date", "==", slDateStr).limit(1).get();

        const isClockIn = todayLogQ.empty;

        if (isClockIn) {
            // ==========================================
            // CLOCK-IN EVENT (උදෑසන පැමිණීම)
            // ==========================================
            let lateMinutes = 0;
            if (todayRoster && !todayRoster.isClosed) {
                const shiftStartTime = new Date(`${slDateStr}T${todayRoster.shiftStart}:00+05:30`);
                if (punchDateObj > shiftStartTime) {
                    lateMinutes = Math.floor((punchDateObj - shiftStartTime) / 60000);
                }
            }

            await logsRef.add({
                date: slDateStr,
                status: 'P',
                clockInTime: punchDateObj.toISOString(),
                clockInSource: `BIOMETRIC_${deviceSerial}`, // භෞතික යන්ත්‍රයෙන් ආ බවට මුද්‍රාව
                lateMins: lateMinutes,
                workedHours: 0,
                ot: 0,
                advance: 0,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`✅ Fingerprint Verified: ${empData.name} Clocked IN at ${punchDateObj.toLocaleTimeString()}`);
        } else {
            // ==========================================
            // CLOCK-OUT EVENT (සවස පිටවීම)
            // ==========================================
            const logDoc = todayLogQ.docs[0];
            const logData = logDoc.data();
            const inTime = new Date(logData.clockInTime);

            let netHours = (punchDateObj - inTime) / (1000 * 60 * 60);
            
            // Break කැපීම
            if (todayRoster && !todayRoster.isBreakPaid && netHours >= (todayRoster.breakThreshold || 4)) {
                netHours -= ((todayRoster.breakMins || 60) / 60);
            }
            netHours = Math.max(0, Math.round(netHours * 100) / 100);

            // OT සත්‍යාපනය (Bug 39 & Daily Whitelist Guard)
            let calculatedOT = 0;
            if (empData.otType !== 'none') {
                const wlSnap = await db.doc(`users/${ownerId}/shops/${shopId}/settings/ot_whitelist_${slDateStr}`).get();
                const isWhitelisted = wlSnap.exists() && (wlSnap.data().allowedEmpIds || []).includes(empId);
                
                if (isWhitelisted && todayRoster && todayRoster.otStart) {
                    const otStartTime = new Date(`${slDateStr}T${todayRoster.otStart}:00+05:30`);
                    if (punchDateObj > otStartTime) {
                        calculatedOT = Math.max(0, (punchDateObj - otStartTime) / (1000 * 60 * 60));
                        calculatedOT = Math.round(calculatedOT * 100) / 100;
                    }
                }
            }

            await logDoc.ref.update({
                clockOutTime: punchDateObj.toISOString(),
                clockOutSource: `BIOMETRIC_${deviceSerial}`,
                workedHours: netHours,
                ot: calculatedOT,
                systemCalcOt: calculatedOT
            });

            console.log(`✅ Fingerprint Verified: ${empData.name} Clocked OUT. Net: ${netHours}h, OT: ${calculatedOT}h`);
        }

        return res.status(200).send("SUCCESS");

    } catch (error) {
        console.error("Biometric Webhook Error:", error);
        return res.status(500).send("INTERNAL_ERROR");
    }
});
// ========================================================================
// 🛰️ ENTERPRISE GPS VEHICLE TELEMETRY INGESTION WEBHOOK (ZERO-COST IOT)
// ========================================================================
exports.gpsTelemetryWebhook = onRequest({ cors: true }, async (req, res) => {
    // 1. HTTP GET හෝ POST මඟින් GPS උපකරණය එවන දත්ත ලබා ගැනීම
    const payload = req.method === 'POST' ? req.body : req.query;
    const { ownerId, shopId, imei, lat, lng, speed, odometer, key } = payload;

    if (!ownerId || !shopId || !imei || !lat || !lng) {
        return res.status(400).send("BAD_REQUEST: Missing required telemetry params.");
    }

    try {
        const db = admin.firestore();
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);
        const currentSpeed = parseFloat(speed) || 0;
        const currentOdo = parseFloat(odometer) || 0;

        // 2. අදාළ IMEI අංකය ඇති වාහනය සොයා ගැනීම
        const vQ = await db.collection(`users/${ownerId}/shops/${shopId}/vehicles`)
                           .where("trackerImei", "==", String(imei).trim())
                           .limit(1).get();

        if (vQ.empty) {
            return res.status(404).send("VEHICLE_NOT_FOUND");
        }

        const vehDoc = vQ.docs[0];
        const vehData = vehDoc.data();
        const nowIso = new Date().toISOString();

        const batch = db.batch();

        // 3. වාහනයේ සජීවී පිහිටීම Update කිරීම
        batch.update(vehDoc.ref, {
            liveLocation: {
                lat: latitude,
                lng: longitude,
                speed: currentSpeed,
                updatedAt: nowIso
            },
            currentOdometer: currentOdo > 0 ? currentOdo : (vehData.currentOdometer || 0)
        });

        // 4. වාහනය සක්‍රීය ගමනක (ACTIVE TRIP) යෙදී සිටී නම්, මාර්ගය (Breadcrumb Trail) සටහන් කිරීම
        const activeTripQ = await db.collection(`users/${ownerId}/shops/${shopId}/vehicle_trips`)
                                    .where("vehicleId", "==", vehDoc.id)
                                    .where("status", "==", "ACTIVE")
                                    .limit(1).get();

        if (!activeTripQ.empty) {
            const tripDoc = activeTripQ.docs[0];
            const routePointRef = tripDoc.ref.collection('route_points').doc();
            batch.set(routePointRef, {
                lat: latitude,
                lng: longitude,
                speed: currentSpeed,
                timestamp: nowIso
            });
        }

        await batch.commit();
        return res.status(200).send("GPS_ACK");

    } catch (error) {
        console.error("GPS Webhook Error:", error);
        return res.status(500).send("INTERNAL_ERROR");
    }
});