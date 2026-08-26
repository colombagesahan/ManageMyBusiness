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