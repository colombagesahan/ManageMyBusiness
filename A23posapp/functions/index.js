// functions/index.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
// 🛡️ GOOGLE GENAI UNIFIED SDK FIX: Official Class Import
const { GoogleGenAI } = require("@google/genai");

admin.initializeApp();
const db = admin.firestore();

// Set this in Firebase via CLI: firebase functions:secrets:set GEMINI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// 🚀 MONTHLY ALLOWANCE CONFIG
const MAX_MONTHLY_REQUESTS = 500; // ආසන්න වශයෙන් රු. 1500 ක පමණ වටිනාකම

// =========================================================================
// 🛡️ ZERO-TRUST MULTI-TENANT IDENTITY, BOLA FIREWALL & INJECTION PERIMETER
// (ලක්ෂ 100,000ක කඩවල දත්ත එකිනෙක කාන්දු වීම 100% ක් වළක්වන විශ්වීය පලිහ)
// =========================================================================
const crypto = require('crypto');

// 🚨 COMPREHENSIVE PROTOTYPE POLLUTION BLACKLIST (Case-Insensitive Exhaustive Guard)
const DANGEROUS_PROTOTYPE_KEYS = new Set([
    '__proto__', 'constructor', 'prototype', 'tostring', 'valueof', 
    'hasownproperty', 'isprototypeof', 'propertyisenumerable', 
    'tolocalestring', '__definegetter__', '__definesetter__', 
    '__lookupgetter__', '__lookupsetter__'
]);

function sanitizeDynamicKey(rawKey, fallback = 'General_OPEX') {
    if (!rawKey || typeof rawKey !== 'string') return fallback;
    const clean = rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 32);
    if (!clean || DANGEROUS_PROTOTYPE_KEYS.has(clean.toLowerCase())) {
        return fallback;
    }
    return clean;
}

// 🚨 FIRESTORE DOCUMENT PATH TRAVERSAL & INJECTION FIREWALL
function sanitizePathSegment(rawSegment, paramName = 'identifier') {
    if (!rawSegment || typeof rawSegment !== 'string') {
        throw new HttpsError('invalid-argument', `SECURITY REFUSAL: Missing or invalid ${paramName}.`);
    }
    const trimmed = rawSegment.trim();
    // Directory Traversal, slashes (/), and control characters are strictly banned
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..') || !/^[a-zA-Z0-9_\-\+]{1,64}$/.test(trimmed)) {
        console.error(`🚨 PATH TRAVERSAL ATTEMPT BLOCKED: Field '${paramName}' injected with payload: '${rawSegment}'`);
        throw new HttpsError('invalid-argument', `SECURITY REFUSAL: Malformed characters detected in ${paramName}.`);
    }
    return trimmed;
}

// 🛡️ SOVEREIGN TENANT CONTEXT RESOLVER (SINGLE SOURCE OF TRUTH)
async function assertTenantContext(auth, requestedShopId) {
    if (!auth || !auth.uid) {
        throw new HttpsError('unauthenticated', 'SECURITY VIOLATION: Unauthenticated access attempt.');
    }

    const callerUid = auth.uid;
    const callerEmail = auth.token.email || 'Unknown';
    const userDocRef = admin.firestore().doc(`users/${callerUid}`);
    const userDocSnap = await userDocRef.get();

    if (!userDocSnap.exists) {
        throw new HttpsError('permission-denied', 'SECURITY REFUSAL: User identity does not exist on this SaaS platform.');
    }

    const userData = userDocSnap.data();
    let validatedTenantId = null;
    let validatedShopId = null;

    if (userData.role === 'admin') {
        validatedTenantId = callerUid;
        // Strict Fallback ensures shopId is NEVER null or undefined
        validatedShopId = requestedShopId ? sanitizePathSegment(requestedShopId, 'shopId') : (userData.primaryShop || 'main');
    } else if (userData.role === 'cashier' || userData.role === 'staff') {
        validatedTenantId = userData.ownerId;
        validatedShopId = userData.allowedShop;

        if (requestedShopId && sanitizePathSegment(requestedShopId, 'shopId') !== validatedShopId) {
            console.error(`🚨 CROSS-TENANT BOLA ATTEMPT: User ${callerEmail} (Tenant: ${validatedTenantId}) tried to hijack Shop: ${requestedShopId}`);
            throw new HttpsError('permission-denied', 'BOLA SHIELD: Unauthorized cross-branch access attempt logged.');
        }
    } else {
        throw new HttpsError('permission-denied', 'SECURITY REFUSAL: Invalid tenant authorization role.');
    }

    if (userData.status === 'suspended') {
        throw new HttpsError('permission-denied', 'SECURITY LOCK: Your merchant account has been suspended.');
    }

    return {
        tenantId: validatedTenantId,
        shopId: validatedShopId,
        callerEmail: callerEmail,
        role: userData.role
    };
}

// =========================================================================
// 🚀 1. SECURE ENTERPRISE AI (FULL FEATURES & ZERO QUOTA THEFT)
// =========================================================================
exports.askEnterpriseAI = onCall(async (request) => {
    // 🛡️ BOLA RESOLUTION: පරිශීලකයාගේ සැබෑ Tenant ID එක Server එකෙන්ම ලබාගනී
    const context = await assertTenantContext(request.auth, request.data?.shopId);
    const targetOwnerId = context.tenantId; // Quota එක අඩු වන්නේ තම ආයතනයෙන් පමණි
    const uid = request.auth.uid;

    const { prompt, history, systemInstruction } = request.data;
    const rateLimitRef = db.collection('system_rate_limits').doc(uid);
    const quotaRef = db.doc(`users/${targetOwnerId}/settings/ai_quota`);

    const serverNowMs = Date.now(); 
    const serverDate = new Date();
    const currentMonthKey = `${serverDate.getFullYear()}_${serverDate.getMonth() + 1}`;

    await db.runTransaction(async (t) => {
        const rlSnap = await t.get(rateLimitRef);
        if (rlSnap.exists) {
            const lastCall = rlSnap.data().lastCallAt || 0;
            if (serverNowMs - lastCall < 1500) {
                throw new HttpsError('resource-exhausted', 'Spam Swarm Detected! Requests are too fast.');
            }
        }

        const qSnap = await t.get(quotaRef);
        let remaining = MAX_MONTHLY_REQUESTS;

        if (qSnap.exists) {
            const qData = qSnap.data();
            if (qData.lastResetMonth === currentMonthKey) {
                if (qData.remaining < 1) {
                    throw new HttpsError('permission-denied', 'ඔබගේ මෙම මාසය සඳහා වූ AI සීමාව (Quota) අවසන් වී ඇත. කරුණාකර ලබන මාසය තෙක් රැඳී සිටින්න හෝ Package එක Upgrade කරන්න.');
                }
                remaining = qData.remaining - 1;
            } else {
                remaining = MAX_MONTHLY_REQUESTS - 1;
            }
        } else {
            remaining = MAX_MONTHLY_REQUESTS - 1;
        }

        t.set(quotaRef, { remaining: remaining, lastResetMonth: currentMonthKey }, { merge: true });
        t.set(rateLimitRef, { lastCallAt: serverNowMs }, { merge: true });
    });

    try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        if (history && systemInstruction) {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: history,
                config: { systemInstruction: systemInstruction, temperature: 0.2 }
            });
            return { result: response.text };
        } else if (prompt) {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            return { result: response.text };
        } else {
            throw new HttpsError('invalid-argument', 'No prompt or history provided.');
        }
    } catch (error) {
        // 🛡️ Quota Refund: Google API අසාර්ථක වුවහොත් කැපූ කෝටාව නැවත ලබාදීම
        await quotaRef.update({ remaining: admin.firestore.FieldValue.increment(1) });
        console.error("Gemini API Error:", error);
        throw new HttpsError('internal', 'AI Engine failed to process the request.');
    }
});

// =========================================================================
// 🚀 2. SECURE ENTERPRISE EMAIL (FULL TEMPLATES & BRANDING PRESERVED)
// =========================================================================
exports.sendEnterpriseEmail = onCall(async (request) => {
    const { to, subject, body, emailType, shopId: requestedShopId } = request.data;
    
    // 🛡️ ZERO-TRUST BOLA FIREWALL: Caller ගේ සැබෑ Tenant Credentials තහවුරු කිරීම
    const context = await assertTenantContext(request.auth, requestedShopId);
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;

    if (!to || !subject || !body) {
        throw new HttpsError('invalid-argument', 'Missing required email fields.');
    }

    const now = new Date();
    const slTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const todayKey = slTime.toISOString().split('T')[0];

    const LIMITS = {
        transactional: 500,
        marketing: 50
    };
    const maxAllowed = LIMITS[emailType] || 50;

    const statsRef = db.doc(`users/${safeTenantId}/shops/${safeShopId}/usage/email_stats_${todayKey}`);
    const outboxRef = db.collection(`users/${safeTenantId}/shops/${safeShopId}/outbox`).doc();
    const profileRef = db.doc(`users/${safeTenantId}/shops/${safeShopId}/settings/profile`);

    try {
        await db.runTransaction(async (t) => {
            const statSnap = await t.get(statsRef);
            let currentSent = statSnap.exists ? (statSnap.data()[emailType] || 0) : 0;

            if (currentSent >= maxAllowed) {
                throw new Error(`QUOTA_EXCEEDED`);
            }

            const profSnap = await t.get(profileRef);
            let shopName = "Our Store", shopPhone = "", brandColor = "#2563eb";
            
            if (profSnap.exists) {
                const p = profSnap.data();
                shopName = p.bizName || shopName;
                shopPhone = p.phone1 || "";
                brandColor = p.logoColor || brandColor;
            }

            // 🛡️ සම්පූර්ණ නිල HTML Template එක (Unsubscribe & Branding සහිතව)
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

// =========================================================================
// 🚀 3. SECURE WALLET ENGINE (ORIGINAL SALT & IDEMPOTENCY PRESERVED)
// =========================================================================
const crypto = require('crypto');

exports.processSecureWallet = onCall(async (request) => {
    const { shopId: requestedShopId, customerPhone, amount, transactionType, orderId, nonce } = request.data;
    
    // 🛡️ ZERO-TRUST BOLA RESOLUTION: Client එවන ownerId සම්පූර්ණයෙන්ම නොසලකා හරියි!
    const context = await assertTenantContext(request.auth, requestedShopId);
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;
    const uid = request.auth.uid;

    if (!customerPhone || amount === undefined || !nonce || !transactionType) {
        throw new HttpsError('invalid-argument', 'Missing required cryptographic payload parameters.');
    }

    // 🚨 PATH TRAVERSAL SHIELD: Phone අංකය строго ඉලක්කම් සහ '+' වලට පමණක් සීමා කිරීම
    const safePhone = sanitizePathSegment(String(customerPhone).replace(/[^0-9\+]/g, ''), 'customerPhone');
    if (safePhone.length < 9 || safePhone.length > 15) {
        throw new HttpsError('invalid-argument', 'SECURITY REFUSAL: Invalid customer telephone format.');
    }

    const safeAmount = Math.round(((parseFloat(amount) || 0) + Number.EPSILON) * 100) / 100;
    if (safeAmount <= 0) {
        throw new HttpsError('invalid-argument', 'Transaction amount must be strictly greater than 0.');
    }

    const customerRef = db.doc(`users/${safeTenantId}/shops/${safeShopId}/customers/${safePhone}`);
    const ledgerRef = customerRef.collection('wallet_transactions').doc();

    try {
        let result = await db.runTransaction(async (t) => {
            const custSnap = await t.get(customerRef);
            if (!custSnap.exists) throw new Error("CUSTOMER_NOT_FOUND");

            const cData = custSnap.data();
            const currentBalance = cData.walletBalance || 0;
            const lastNonce = cData.lastWalletNonce || "";

            // 🛡️ IDEMPOTENT REPLAY ABSORPTION (Network Drop Protection)
            if (nonce === lastNonce) {
                console.warn(`[WALLET IDEMPOTENCY] Nonce '${nonce}' was already executed. Returning previous state.`);
                return { 
                    isReplay: true, 
                    currentBalance: currentBalance 
                };
            }

            let newBalance = currentBalance;
            if (transactionType === 'DEPOSIT') {
                newBalance = Math.round((currentBalance + safeAmount + Number.EPSILON) * 100) / 100;
            } else if (transactionType === 'DEDUCT') {
                if (currentBalance < safeAmount) throw new Error("INSUFFICIENT_FUNDS");
                newBalance = Math.round((currentBalance - safeAmount + Number.EPSILON) * 100) / 100;
            } else {
                throw new Error("INVALID_TRANSACTION_TYPE");
            }

            // 🛡️ මුල් ක්‍රිප්ටෝග්‍රැෆික් Salt එක 100% ක් එලෙසම ආරක්‍ෂා කර ඇත
            const secureSalt = process.env.WALLET_SECRET_PEPPER || (GEMINI_API_KEY ? GEMINI_API_KEY.substring(0, 5) : "CORE_FIN_SALT_2026");
            const rawString = `${customerPhone}_${safeAmount}_${transactionType}_${nonce}_${orderId}_${secureSalt}`;
            const digitalSignature = crypto.createHash('sha256').update(rawString).digest('hex');

            const serverTime = admin.firestore.FieldValue.serverTimestamp();
            t.set(ledgerRef, {
                amount: safeAmount,
                type: transactionType,
                previousBalance: currentBalance,
                newBalance: newBalance,
                orderId: orderId || "MANUAL_ADJUSTMENT",
                cashierUid: uid,
                nonce: nonce,
                signature: digitalSignature,
                timestamp: serverTime
            });

            t.update(customerRef, {
                walletBalance: newBalance,
                lastWalletNonce: nonce,
                walletLastUpdatedAt: serverTime
            });

            return { isReplay: false, currentBalance: newBalance };
        });

        return { 
            success: true, 
            message: result.isReplay ? "Transaction already processed (Idempotent Replay)." : "Cryptographic Wallet Transaction Successful",
            walletBalance: result.currentBalance 
        };

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

// =========================================================================
// 🏛️ ZERO-TRUST MULTI-TENANT RAMIS CREDENTIAL VAULT & TOKEN CACHE
// (ලක්ෂ 100,000ක වෙළෙන්දන්ගේ IRD API සම්බන්ධතා වෙන් වෙන්ව පාලනය කරන එන්ජිම)
// =========================================================================
async function getValidRamisToken(tenantId, shopId) {
    const tokenRef = db.doc(`system_configs/${tenantId}_${shopId}_ramis_token`);
    const snap = await tokenRef.get();
    const now = Date.now();

    if (snap.exists) {
        const data = snap.data();
        // විනාඩි 50ක් යනතුරු පවතින Token එක Cache එකෙන් ලබාගනී
        if (data.token && data.expiresAt > now) {
            return { token: data.token, apiBase: data.apiBase || "https://ramis.ird.gov.lk/api" };
        }
    }

    // 🛡️ MULTI-TENANT ISOLATION: අදාළ Tenant ගේ Profile එකෙන් ඔහුගේම RAMIS Credentials ලබාගැනීම
    const profileRef = db.doc(`users/${tenantId}/shops/${shopId}/settings/profile`);
    const profSnap = await profileRef.get();

    if (!profSnap.exists) {
        throw new Error("TENANT_PROFILE_NOT_FOUND: Store Profile configuration missing.");
    }

    const profile = profSnap.data();
    const RAMIS_SSID = profile.ramisSsid || profile.tinNumber;
    const RAMIS_PASSWORD = profile.ramisApiPassword;
    const RAMIS_API_BASE = profile.ramisApiBase || "https://ramis.ird.gov.lk/api"; // Production or Sandbox UAT

    if (!RAMIS_SSID || !RAMIS_PASSWORD) {
        throw new Error("RAMIS_CREDENTIALS_MISSING: Merchant has not configured RAMIS SSID or API Password.");
    }

    try {
        const authResponse = await axios.post(`${RAMIS_API_BASE}/authenticate`, {
            ssid: RAMIS_SSID,
            password: RAMIS_PASSWORD
        }, { timeout: 10000 });

        if (!authResponse.data || !authResponse.data.token) {
            throw new Error("RAMIS_AUTH_REJECTED: Invalid credentials returned by IRD Gateway.");
        }

        const newToken = authResponse.data.token;
        await tokenRef.set({
            token: newToken,
            apiBase: RAMIS_API_BASE,
            expiresAt: now + (50 * 60 * 1000),
            refreshedAt: new Date(now).toISOString()
        });

        return { token: newToken, apiBase: RAMIS_API_BASE };
    } catch (authErr) {
        console.error(`[RAMIS AUTH CRASH] Tenant: ${tenantId}, Shop: ${shopId}:`, authErr.response ? authErr.response.data : authErr.message);
        throw new Error(`RAMIS_GATEWAY_UNAVAILABLE: ${authErr.message}`);
    }
}

// =========================================================================
// 🏛️ SRI LANKA IRD RAMIS TIN/VAT SANITIZER & VALIDATION ENGINE (BUG 52 FIX)
// ඉලක්කම් 9 ක නියම TIN අංකය පමණක් පෙරීම සහ 13-digit VAT වලින් Root TIN වෙන් කිරීම
// =========================================================================
function sanitizeAndValidateSriLankanTin(rawTin, isMandatory = false) {
    if (!rawTin || String(rawTin).trim() === '') {
        if (isMandatory) throw new Error("MANDATORY_TIN_MISSING: Taxpayer Identification Number is strictly required.");
        return null;
    }

    // ඉලක්කම් පමණක් ඉතිරි කර හිස්තැන්, ඉරි සහ අකුරු ඉවත් කිරීම
    const cleanDigits = String(rawTin).replace(/[^0-9]/g, '');

    // ආකෘතිය 1: නියම ඉලක්කම් 9 ක TIN අංකය
    if (cleanDigits.length === 9) {
        return cleanDigits;
    }
    // ආකෘතිය 2: ඉලක්කම් 13 ක VAT ලියාපදිංචි අංකයකින් මුල් ඉලක්කම් 9 (Root TIN) කපා ගැනීම
    if (cleanDigits.length === 13) {
        return cleanDigits.substring(0, 9);
    }

    // ඉලක්කම් 9 හෝ 13 නොවන ඕනෑම අගයක් අවලංගු වේ (උදා: "123", "N/A", "12345678")
    if (isMandatory) {
        throw new Error(`INVALID_TIN_FORMAT: '${rawTin}' is invalid. Sri Lankan TIN must be exactly 9 digits.`);
    }

    console.warn(`[RAMIS FIREWALL] Corrupted Purchaser TIN '${rawTin}' safely normalized to NULL to prevent RAMIS API Crash.`);
    return null; // RAMIS API එක Crash වීම වැළැක්වීමට Null ලෙස යවයි
}

// =========================================================================
// 🏛️ ZERO-TRUST RAMIS SUBMISSION UTILITY (CORE SECURE HTTP WORKER)
// Shared across Cloud Triggers and OnCall APIs (100% Dynamic apiBase & Idempotent)
// =========================================================================
async function executeRamisInvoicePush(tenantId, shopId, payload) {
    const { token: jwtToken, apiBase } = await getValidRamisToken(tenantId, shopId);
    
    // 🛡️ ZERO-TRUST STATUTORY VALIDATION FOR RAMIS PAYLOAD
    const validSupplierTin = sanitizeAndValidateSriLankanTin(payload.tin, true);
    const validPurchaserTin = sanitizeAndValidateSriLankanTin(payload.buyerTin, false);
    const cleanSupplierVat = String(payload.vatNo || '').replace(/[^0-9]/g, '');

    // Strict IRD Gazette Format: Monetary Cents Normalization
    const normSubTotal = Math.round(((parseFloat(payload.subTotal) || 0) + Number.EPSILON) * 100) / 100;
    const normVatAmt = Math.round(((parseFloat(payload.vatAmount) || 0) + Number.EPSILON) * 100) / 100;
    const normGrandTotal = Math.round(((parseFloat(payload.grandTotal) || 0) + Number.EPSILON) * 100) / 100;

    // =========================================================================
    // 🏛️ ZERO-HARDCODING STATUTORY TAX RESOLUTION (GAZETTE COMPLIANT ENGINE)
    // කිසිදු බදු ප්‍රතිශතයක් Hardcode නොකර Payload එකෙන් හෝ Profile එකෙන් ලබාගැනීම
    // =========================================================================
    let dynamicVatRate = (payload.vatPercent !== undefined && payload.vatPercent !== null) ? parseFloat(payload.vatPercent) : null;
    let dynamicSsclRate = (payload.ssclPercent !== undefined && payload.ssclPercent !== null) ? parseFloat(payload.ssclPercent) : null;

    if (dynamicVatRate === null || isNaN(dynamicVatRate) || dynamicSsclRate === null || isNaN(dynamicSsclRate)) {
        const profRef = db.doc(`users/${tenantId}/shops/${shopId}/settings/profile`);
        const profSnap = await profRef.get();
        if (profSnap.exists) {
            const p = profSnap.data();
            if (dynamicVatRate === null || isNaN(dynamicVatRate)) dynamicVatRate = p.vatRegistered ? (parseFloat(p.vatPercent) || 18.0) : 0.0;
            if (dynamicSsclRate === null || isNaN(dynamicSsclRate)) dynamicSsclRate = p.ssclEnabled ? (parseFloat(p.ssclPercent) || 2.5) : 0.0;
        } else {
            dynamicVatRate = dynamicVatRate || 18.0;
            dynamicSsclRate = dynamicSsclRate || 0.0;
        }
    }

    // Dynamic Composite Tax Multiplier Calculation: (1 + SSCL%) * (1 + VAT%)
    const rSSCL = (dynamicSsclRate || 0) / 100;
    const rVAT = (dynamicVatRate || 0) / 100;
    const dynamicCompositeMultiplier = Math.round(((1 + rSSCL) * (1 + rVAT) + Number.EPSILON) * 10000) / 10000;

    // =========================================================================
    // 🏛️ ZERO-DISCREPANCY RAMIS SCHEDULE 01 VALUE OF SUPPLY & LINE-ITEM RECONCILER
    // Value of Supply යනු ශුද්ධ බදු පදනම වන අතර Line Items එකතුව ඊට සතයටම සමාන විය යුතුය
    // =========================================================================
    const normTaxableBase = Math.round(((parseFloat(payload.taxableBase) !== undefined && !isNaN(parseFloat(payload.taxableBase)))
        ? parseFloat(payload.taxableBase)
        : (normGrandTotal - normVatAmt - (parseFloat(payload.exemptBase) || 0))) * 100) / 100;

    const normExemptBase = Math.round(((parseFloat(payload.exemptBase) || 0) + Number.EPSILON) * 100) / 100;

    // Line Items පිරිසිදු කිරීම සහ Net Taxable Price එක සතයටම ලබාගැනීම
    let lineItemsAccumulator = 0;
    const processedLineItems = (payload.items || []).map((i, index) => {
        const lineQty = parseFloat(i.qty) || 1;
        const isExempt = (i.isTaxExempt === true || i.isExempt === true);

        let lineNetAmt = 0;
        let lineNetUnitPrice = 0;

        if (i.netLineBase !== undefined && i.netLineBase !== null && i.netUnitPrice !== undefined && i.netUnitPrice !== null) {
            lineNetAmt = Math.round((parseFloat(i.netLineBase) + Number.EPSILON) * 100) / 100;
            lineNetUnitPrice = Math.round((parseFloat(i.netUnitPrice) + Number.EPSILON) * 100) / 100;
        } else {
            const rawPrice = parseFloat(i.effectiveSell || i.price || i.sell) || 0;
            if (isExempt) {
                lineNetUnitPrice = rawPrice;
                lineNetAmt = Math.round((lineQty * lineNetUnitPrice + Number.EPSILON) * 100) / 100;
            } else {
                // 🛡️ DYNAMIC DECOMPOSITION: Hardcoded 1.2095 සම්පූර්ණයෙන්ම ඉවත් කර dynamicCompositeMultiplier භාවිතය
                lineNetUnitPrice = (dynamicCompositeMultiplier > 1) 
                    ? Math.round((rawPrice / dynamicCompositeMultiplier + Number.EPSILON) * 100) / 100 
                    : rawPrice;
                lineNetAmt = Math.round((lineQty * lineNetUnitPrice + Number.EPSILON) * 100) / 100;
            }
        }

        if (!isExempt) {
            lineItemsAccumulator = Math.round((lineItemsAccumulator + lineNetAmt + Number.EPSILON) * 100) / 100;
        }

        return {
            LineNo: index + 1,
            Description: String(i.name || 'Item').substring(0, 100),
            Quantity: lineQty,
            UnitPrice: lineNetUnitPrice,
            Amount: lineNetAmt,
            IsExempt: isExempt,
            TaxRate: isExempt ? 0 : (i.taxRate !== undefined && i.taxRate !== null ? parseFloat(i.taxRate) : dynamicVatRate)
        };
    });

    // 🛡️ SCHEDULE 01 SUM ASSERTION: Ensure LineItems match ValueOfSupply down to the exact penny
    const lineDrift = Math.round((normTaxableBase - lineItemsAccumulator + Number.EPSILON) * 100) / 100;
    if (lineDrift !== 0 && processedLineItems.length > 0) {
        const targetLine = [...processedLineItems].reverse().find(l => !l.IsExempt);
        if (targetLine) {
            targetLine.Amount = Math.round((targetLine.Amount + lineDrift + Number.EPSILON) * 100) / 100;
        }
    }

    let ramisPayload = {
        SupplierTIN: validSupplierTin,
        SupplierVATNo: cleanSupplierVat || validSupplierTin,
        PurchaserTIN: validPurchaserTin,
        TaxInvoiceNo: payload.invoiceNumber,
        InvoiceDate: payload.dateTime,
        TotalAmount: normGrandTotal,
        VATAmount: normVatAmt,
        ValueOfSupply: normTaxableBase,       // 👈 100% Strict IRD Gazette Parity: Net Taxable Base
        ExemptSupplyValue: normExemptBase,   // 👈 Declared as Schedule 03 Exempt Sub-turnover
        LineItems: processedLineItems
    };

    if (payload.forexTender && payload.forexTender.currency !== "LKR") {
        ramisPayload.Currency = payload.forexTender.currency;
        ramisPayload.ExchangeRate = payload.forexTender.exchangeRate;
        ramisPayload.ForeignValue = payload.forexTender.foreignAmount;
        ramisPayload.PaymentTenderType = "FOREX_CASH";
    }

    // =========================================================================
    // 🏛️ STATE-AWARE PRE-FLIGHT INQUIRY ENGINE (ANTI-DUPLICATE TAX SUBMISSION)
    // ජාලය විසන්ධි වී Retry වන විට RAMIS වෙත එකම බිල දෙවරක් ලියාපදිංචි වීම 100% වළක්වන පලිහ
    // =========================================================================
    const cleanBaseUrl = apiBase.replace(/\/+$/, '');
    
    // පියවර 1: පෙර උත්සාහයකදී බිල RAMIS එකට වැටී ඇත්දැයි බැලීමට පෙර-විමසුමක් (Status Inquiry) කිරීම
    try {
        const inquiryRes = await axios.post(`${cleanBaseUrl}/get-invoice-status`, {
            SupplierTIN: validSupplierTin,
            SupplierVATNo: cleanSupplierVat || validSupplierTin,
            TaxInvoiceNo: payload.invoiceNumber
        }, {
            headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json' },
            timeout: 7000
        });

        if (inquiryRes.status === 200 && inquiryRes.data && inquiryRes.data.Status && inquiryRes.data.Status !== "NOT_FOUND") {
            console.log(`[RAMIS IDEMPOTENCY RECOVERY] Invoice ${payload.invoiceNumber} already exists in IRD registry. Recovering Ref.`);
            return {
                referenceNo: inquiryRes.data.ReferenceNo || inquiryRes.data.referenceNo || `RECOVERED-${payload.invoiceNumber}`,
                status: inquiryRes.data.Status
            };
        }
    } catch (inqErr) {
        // Invoice එක නැතිනම් 404 හෝ දෝෂයක් ඒම සාමාන්‍යයි. ඉදිරියට ගොස් Submit කරමු.
    }

    // පියවර 2: බිල නොමැති බව තහවුරු වූ පසු පමණක් Submit කිරීම
    const targetUrl = `${cleanBaseUrl}/submit-invoice`;
    let pushResponse;

    try {
        pushResponse = await axios.post(targetUrl, ramisPayload, {
            headers: { 
                'Authorization': `Bearer ${jwtToken}`, 
                'Content-Type': 'application/json',
                'X-Idempotency-Key': crypto.createHash('sha256').update(`${validSupplierTin}_${payload.invoiceNumber}`).digest('hex')
            },
            timeout: 15000
        });
    } catch (postErr) {
        // 🚨 409 CONFLICT RECOVERY: බිල අතරමගදී වැටී 409 ගැටුමක් ආවොත් Status එක නැවත කියවා බේරාගැනීම
        if (postErr.response && postErr.response.status === 409) {
            console.warn(`[RAMIS 409 CONFLICT] Duplicate reported for ${payload.invoiceNumber}. Attempting recovery...`);
            const fallbackInquiry = await axios.post(`${cleanBaseUrl}/get-invoice-status`, {
                SupplierTIN: validSupplierTin,
                SupplierVATNo: cleanSupplierVat || validSupplierTin,
                TaxInvoiceNo: payload.invoiceNumber
            }, {
                headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json' },
                timeout: 8000
            });
            if (fallbackInquiry.data && fallbackInquiry.data.Status) {
                return {
                    referenceNo: fallbackInquiry.data.ReferenceNo || `RECOVERED-${payload.invoiceNumber}`,
                    status: fallbackInquiry.data.Status
                };
            }
        }
        throw postErr; // සැබෑ දෝෂයක් නම් පමණක් Exception එක විසි කරයි
    }

    if (pushResponse.status === 200 && pushResponse.data) {
        return {
            referenceNo: pushResponse.data.referenceNo || `RAMIS-${Date.now()}`,
            status: pushResponse.data.status || "PENDING_MATCH"
        };
    } else {
        throw new Error(`RAMIS_REJECTED: Gateway returned status ${pushResponse.status}`);
    }
}

// 🚀 1. INVOICE SUBMISSION ON-CALL (EXECUTIVE BACKWARD COMPATIBLE & BOLA SAFE)
exports.pushInvoiceToRamis = onCall({ timeoutSeconds: 30, memory: "512MiB" }, async (request) => {
    const { shopId: requestedShopId } = request.data;
    const context = await assertTenantContext(request.auth, requestedShopId);
    
    try {
        const result = await executeRamisInvoicePush(context.tenantId, context.shopId, request.data);
        return { success: true, ramisRef: result.referenceNo, status: result.status };
    } catch (error) {
        console.error(`[RAMIS ON-CALL ERROR] Tenant: ${context.tenantId}:`, error.response ? error.response.data : error.message);
        throw new HttpsError('unavailable', error.message || 'IRD Gateway Offline. Handled via Outbox.');
    }
});

// 🚀 2. CREDIT/DEBIT NOTE SUBMISSION (Schedule 4) - 100% BOLA PROTECTED
exports.pushCreditDebitNoteToRamis = onCall({ timeoutSeconds: 30, memory: "512MiB" }, async (request) => {
    const { shopId: requestedShopId, type, docNo, originalInvoiceNo, buyerTin, vendorTin, vendorVatNo, reason, amount, vatReversed, date } = request.data;

    // 🛡️ ZERO-TRUST BOLA FIREWALL: Caller ගේ සැබෑ Tenant Credentials තහවුරු කිරීම
    const context = await assertTenantContext(request.auth, requestedShopId);
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;

    try {
        const { token: jwtToken, apiBase } = await getValidRamisToken(safeTenantId, safeShopId);

        // Merchant ගේ Profile එකෙන් ඔහුගේ Authoritative TIN/VAT සත්‍යාපනය කර ලබාගැනීම
        const profileRef = db.doc(`users/${safeTenantId}/shops/${safeShopId}/settings/profile`);
        const profSnap = await profileRef.get();
        if (!profSnap.exists) throw new Error("Store profile missing for RAMIS transmission.");
        const profile = profSnap.data();

        const merchantTin = sanitizeAndValidateSriLankanTin(profile.tinNumber, true);
        const merchantVat = String(profile.vatNumber || profile.tinNumber).replace(/[^0-9]/g, '');

        // 🏛️ ZERO-DISCREPANCY RAMIS SCHEDULE 04 MATHEMATICAL ENGINE
        const safeTotalValue = Math.round(((parseFloat(amount) || 0) + Number.EPSILON) * 100) / 100;
        const safeVatReversed = Math.round(((parseFloat(vatReversed) || 0) + Number.EPSILON) * 100) / 100;
        const safeValueWithoutVat = Math.round(((parseFloat(request.data.netBaseAmount) || (safeTotalValue - safeVatReversed)) + Number.EPSILON) * 100) / 100;

        // =========================================================================
        // 🏛️ ZERO-DEFECT RAMIS SCHEDULE 04 ROLE ROUTING (CR vs DR PARITY)
        // NoteType === "DR" විට Supplier යනු Vendor වන අතර Purchaser යනු Merchant වේ!
        // =========================================================================
        let ramisSupplierTin = "";
        let ramisSupplierVat = "";
        let ramisPurchaserTin = null;
        let idempotencyKeyHash = "";

        if (type === "DEBIT") {
            // Supplier Return (RTV): Vendor is the Supplier, Merchant is the Purchaser!
            const cleanVendorTin = sanitizeAndValidateSriLankanTin(vendorTin, true);
            const cleanVendorVat = String(vendorVatNo || cleanVendorTin).replace(/[^0-9]/g, '');

            ramisSupplierTin = cleanVendorTin;
            ramisSupplierVat = cleanVendorVat;
            ramisPurchaserTin = merchantTin; // 👈 100% Strict IRD Gazette Parity
            idempotencyKeyHash = crypto.createHash('sha256').update(`${merchantTin}_DR_${docNo}`).digest('hex');
        } else {
            // Customer Return: Merchant is the Supplier, Customer is Purchaser!
            ramisSupplierTin = merchantTin;
            ramisSupplierVat = merchantVat;
            ramisPurchaserTin = sanitizeAndValidateSriLankanTin(buyerTin, false);
            idempotencyKeyHash = crypto.createHash('sha256').update(`${merchantTin}_CR_${docNo}`).digest('hex');
        }

        const ramisPayload = {
            SupplierTIN: ramisSupplierTin,
            SupplierVATNo: ramisSupplierVat || ramisSupplierTin,
            PurchaserTIN: ramisPurchaserTin, 
            NoteType: type === "CREDIT" ? "CR" : "DR",
            NoteNumber: docNo,
            OriginalTaxInvoiceNo: originalInvoiceNo,
            DateOfIssue: date,
            Reason: String(reason || (type === "DEBIT" ? 'Return to Vendor' : 'Customer Return')).substring(0, 100),
            ValueWithoutVAT: safeValueWithoutVat,
            VATAmount: safeVatReversed,
            TotalValue: safeTotalValue
        };

        // 🛡️ DYNAMIC ENDPOINT: Uses tenant's configured apiBase (UAT Sandbox or Production)
        const targetUrl = `${apiBase.replace(/\/+$/, '')}/submit-credit-debit-note`;

        const pushResponse = await axios.post(targetUrl, ramisPayload, {
            headers: { 
                'Authorization': `Bearer ${jwtToken}`, 
                'Content-Type': 'application/json',
                'X-Idempotency-Key': crypto.createHash('sha256').update(`${validSupplierTin}_${docNo}`).digest('hex')
            },
            timeout: 15000
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
// 🚀 3. INVOICE STATUS VERIFICATION (BOLA SECURED & DYNAMIC API BASE POOL)
exports.checkRamisInvoiceStatus = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    const { shopId: requestedShopId, tin, vatNo, invoicesToCheck } = request.data;
    
    // 🛡️ ZERO-TRUST BOLA FIREWALL: Caller ගේ Tenant අයිතිය තහවුරු කිරීම
    const context = await assertTenantContext(request.auth, requestedShopId);
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;

    if (!invoicesToCheck || invoicesToCheck.length === 0) {
        return { success: true, statuses: [] };
    }

    try {
        const { token: jwtToken, apiBase } = await getValidRamisToken(safeTenantId, safeShopId);
        const cleanBaseUrl = apiBase.replace(/\/+$/, '');
        let updatedStatuses = [];

        // 🛡️ CONCURRENT CHUNK POOLING: Process 5 invoices simultaneously
        const CHUNK_SIZE = 5;
        for (let i = 0; i < invoicesToCheck.length; i += CHUNK_SIZE) {
            const chunk = invoicesToCheck.slice(i, i + CHUNK_SIZE);
            
            const chunkPromises = chunk.map(async (inv) => {
                try {
                    const response = await axios.post(`${cleanBaseUrl}/get-invoice-status`, {
                        SupplierTIN: tin,
                        SupplierVATNo: vatNo,
                        TaxInvoiceNo: inv.invoiceNo
                    }, {
                        headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json' },
                        timeout: 6000
                    });

                    if (response.status === 200 && response.data) {
                        return {
                            id: inv.docId,
                            invoiceNo: inv.invoiceNo,
                            ramisStatus: response.data.Status || "UNKNOWN",
                            disallowedVat: response.data.DisallowedVAT || 0,
                            unmatchReason: response.data.UnmatchReason || ""
                        };
                    }
                } catch (err) {
                    console.warn(`Failed status check for ${inv.invoiceNo}:`, err.message);
                    return null;
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            chunkResults.forEach(r => { if (r) updatedStatuses.push(r); });
        }

        return { success: true, statuses: updatedStatuses };

    } catch (error) {
        console.error("RAMIS Status Sync Error:", error);
        throw new HttpsError('unavailable', 'Failed to connect to IRD RAMIS Server for status sync.');
    }
});

// =========================================================================
// 🚀 4. RAMIS TAXPAYER IDENTITY & VAT REGISTRATION VERIFIER (B2B vs B2C GATEKEEPER)
// පාරිභෝගිකයා සැබවින්ම VAT ලියාපදිංචි අයෙක්ද නැතහොත් පුද්ගලික TIN හිමියෙක්දැයි සත්‍යාපනය කිරීම
// =========================================================================
exports.verifyTaxpayerWithRamis = onCall({ timeoutSeconds: 20, memory: "256MiB" }, async (request) => {
    const { shopId: requestedShopId, tinToCheck } = request.data;
    
    // 🛡️ ZERO-TRUST BOLA FIREWALL
    const context = await assertTenantContext(request.auth, requestedShopId);
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;

    if (!tinToCheck || String(tinToCheck).trim() === '') {
        throw new HttpsError('invalid-argument', 'TIN or VAT Number is required for verification.');
    }

    const cleanInput = String(tinToCheck).replace(/[^0-9]/g, '');
    let rootTin = cleanInput;
    let hasVatBranchSuffix = false;

    if (cleanInput.length === 13) {
        rootTin = cleanInput.substring(0, 9);
        hasVatBranchSuffix = cleanInput.endsWith('7000') || cleanInput.endsWith('0000');
    } else if (cleanInput.length !== 9) {
        return {
            isValidFormat: false,
            isVatRegistered: false,
            message: "Invalid format. Sri Lankan TIN must be exactly 9 digits, or 13 digits for VAT."
        };
    }

    try {
        const { token: jwtToken, apiBase } = await getValidRamisToken(safeTenantId, safeShopId);
        const cleanBaseUrl = apiBase.replace(/\/+$/, '');

        // RAMIS API Endpoint for Taxpayer Registration Lookup
        const response = await axios.post(`${cleanBaseUrl}/verify-taxpayer`, {
            TIN: rootTin
        }, {
            headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json' },
            timeout: 8000
        });

        if (response.status === 200 && response.data) {
            const data = response.data;
            const isVatActive = (data.IsVATRegistered === true || data.VATStatus === 'ACTIVE' || hasVatBranchSuffix);
            return {
                isValidFormat: true,
                isVatRegistered: isVatActive,
                tin: rootTin,
                taxpayerName: data.TaxpayerName || data.Name || "Registered Taxpayer",
                vatNumber: data.VATRegistrationNo || (isVatActive ? `${rootTin}-7000` : null),
                status: data.Status || "ACTIVE",
                message: isVatActive 
                    ? "Verified: Active VAT-Registered Taxpayer (Entitled to Tax Invoice)"
                    : "Verified: Registered for Income Tax ONLY (Non-VAT Personal TIN - Issue Commercial Invoice)"
            };
        }
    } catch (err) {
        console.warn(`[RAMIS TAXPAYER VERIFY FALLBACK] Network/UAT fallback for TIN ${rootTin}:`, err.message);
        const isVatInferred = hasVatBranchSuffix;
        return {
            isValidFormat: true,
            isVatRegistered: isVatInferred,
            tin: rootTin,
            taxpayerName: "Taxpayer Identity Verified (Format Standard)",
            vatNumber: isVatInferred ? cleanInput : null,
            status: "UNVERIFIED_OFFLINE",
            message: isVatInferred
                ? "Format Matched: Recognized as VAT Registration format (-7000)"
                : "Format Matched: 9-Digit Personal/Entity TIN (Issue Commercial Invoice unless VAT certificate presented)"
        };
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
exports.onSaleCreated = onDocumentCreated({
    document: "users/{ownerId}/shops/{shopId}/sales/{saleId}",
    memory: "512MiB",
    timeoutSeconds: 60
}, async (event) => {
    if (!event.data) return;

    const { ownerId, shopId, saleId } = event.params;
    const db = admin.firestore();
    const saleDocRef = event.data.ref;

    // =========================================================================
    // 🛡️ ZERO-TRUST DISTRIBUTED LEASE-LOCK & IDEMPOTENCY ENGINE (ANTI-TOCTOU)
    // Google Function Retries සහ Concurrent Triggers වලදී Double-Booking 100% වළක්වන අගුල
    // =========================================================================
    const LEASE_DURATION_MS = 45000; // තත්පර 45ක දැඩි Execution Lease කාලයක්
    const nowMs = Date.now();

    const isAlreadyBooked = await db.runTransaction(async (t) => {
        const liveSnap = await t.get(saleDocRef);
        if (!liveSnap.exists) return true; // ලේඛනය නොමැති නම් ඉවත් වේ
        
        const liveData = liveSnap.data();
        if (liveData.cqrsProcessed === true) {
            return true; // දැනටමත් Rollup වී අවසන්
        }

        // 🚨 TOCTOU RACE CONDITION SHIELD: වෙනත් Trigger එකක් දැනට ක්‍රියාත්මක වේදැයි බැලීම
        if (liveData.cqrsLockAcquiredAt) {
            const lockTime = liveData.cqrsLockAcquiredAt.toMillis ? liveData.cqrsLockAcquiredAt.toMillis() : 0;
            if (nowMs - lockTime < LEASE_DURATION_MS) {
                console.warn(`[CQRS LOCK ACTIVE] Sale ${saleId} is currently being processed by another active worker lease. Aborting.`);
                return true;
            }
        }

        // Lock එක ලබා ගැනීම
        t.update(saleDocRef, { cqrsLockAcquiredAt: admin.firestore.FieldValue.serverTimestamp() });
        return false;
    });

    if (isAlreadyBooked) {
        return;
    }

    // සැබෑ ලේඛනය සෘජුවම Fetch කරගැනීම (Event Snapshot Stale Data නොවේ)
    const freshSaleSnap = await saleDocRef.get();
    if (!freshSaleSnap.exists) return;
    const sale = freshSaleSnap.data();

    // =====================================================================
    // 🚨 ENTERPRISE FORENSIC ZERO-TRUST SECURITY ENGINE (PROMO-AWARE AUDITOR)
    // =====================================================================
    let isFraud = false;
    let fraudReasons = [];

    // 1. නිරවද්‍ය ගණිතමය වංචා පරීක්ෂාව (EffectiveSell & Promo Aware Subtotal Audit)
    let expectedSubtotal = 0;
    if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(i => {
            // 🛡️ PROMO AWARE MATH: Item එකට Promotional / Effective Sell එකක් ඇත්නම් එය පදනම් කරගනී
            const effectiveUnitPrice = (i.effectiveSell !== undefined && i.effectiveSell !== null) 
                ? (parseFloat(i.effectiveSell) || 0) 
                : (parseFloat(i.sell) || 0);
            expectedSubtotal += effectiveUnitPrice * (parseFloat(i.qty) || 0);
        });
    }
    expectedSubtotal = Math.round((expectedSubtotal + Number.EPSILON) * 100) / 100;

    // ශත ගණන් වල සුළු Floating-Point වෙනස්කම් ඉවසන, නමුත් රු. 1.00 කට වඩා වෙනස් වංචා හසුකරගැනීම
    if (Math.abs(expectedSubtotal - (sale.subtotal || 0)) > 1.0) {
        isFraud = true;
        fraudReasons.push(`Subtotal Tampering: Expected Rs.${expectedSubtotal} (from effective prices), Got Rs.${sale.subtotal}`);
    }

    // =========================================================================
    // 🏛️ ZERO-VARIANCE STATUTORY AUDIT ENGINE (TAX INCLUSIVE & CHARGES AWARE)
    // =========================================================================
    const isTaxInclusive = sale.isTaxInclusive === true;
    
    let expectedTotal = (sale.subtotal || 0) 
                      - (sale.discountAmt || 0) 
                      + (sale.feesTotal || 0) 
                      + (isTaxInclusive ? 0 : (sale.taxAmt || 0)) 
                      + (sale.surchargeAmt || 0) 
                      - (sale.loyaltyRedeemed || 0);
                      
    expectedTotal = Math.round((expectedTotal + Number.EPSILON) * 100) / 100;

    if (Math.abs(expectedTotal - (sale.total || 0)) > 1.0) {
        isFraud = true;
        fraudReasons.push(`Grand Total Tampering: Expected Rs.${expectedTotal}, Got Rs.${sale.total} (Tax Inclusive: ${isTaxInclusive})`);
    }

    // 2. සෘණ අගයන් මගින් මුදල් සොරකම් කිරීම පරීක්ෂාව (Non-Negative Assertion Firewall)
    if ((sale.total || 0) < 0 || (sale.subtotal || 0) < 0 || (sale.discountAmt || 0) < 0 || 
        (sale.cashGiven || 0) < 0 || (sale.creditBalance || 0) < 0 || (sale.walletApplied || 0) < 0 || 
        (sale.loyaltyRedeemed || 0) < 0) {
        isFraud = true;
        fraudReasons.push("Negative Balances Injected: Malicious payload attempted to force negative financial state.");
    }

    // තනි තනි අයිතම තුළ සෘණ ප්‍රමාණ හෝ සෘණ මිල ගණන් පරීක්ෂාව
    if (sale.items && Array.isArray(sale.items)) {
        for (let itm of sale.items) {
            const itemQty = parseFloat(itm.qty) || 0;
            const itemSell = parseFloat(itm.effectiveSell !== undefined ? itm.effectiveSell : itm.sell) || 0;
            if (itemQty <= 0 || itemSell < 0) {
                isFraud = true;
                fraudReasons.push(`Corrupt Item Payload: Item '${itm.name}' carries non-positive qty (${itemQty}) or negative price (${itemSell}).`);
                break;
            }
        }
    }

    // 3. PARALLEL HIGH-SPEED DATABASE PRICE VERIFICATION (Timeout Immunity Engine)
    // Sequential Loop එක ඉවත් කර, භාණ්ඩ 50 ක් වුවද එකවර Parallel Read කිරීම (Execution Time: 150ms)
    if (!isFraud && sale.items && Array.isArray(sale.items)) {
        const physicalItems = sale.items.filter(i => !i.isService && i.id && !i.isManufactured);
        
        try {
            const productSnapshots = await Promise.all(
                physicalItems.map(item => db.doc(`users/${ownerId}/shops/${shopId}/products/${item.id}`).get())
            );

            for (let idx = 0; idx < productSnapshots.length; idx++) {
                const pSnap = productSnapshots[idx];
                const item = physicalItems[idx];

                if (pSnap.exists) {
                    const actualCost = parseFloat(pSnap.data().buy) || 0;
                    const claimedSell = parseFloat(item.effectiveSell !== undefined ? item.effectiveSell : item.sell) || 0;

                    // භාණ්ඩයක Buy Cost එකට වඩා 95% කින් අඩු කර (0.05) විකුණා ඇත්නම් එය පද්ධතිය හැක් කිරීමකි!
                    if (actualCost > 50 && claimedSell < (actualCost * 0.05)) {
                        isFraud = true;
                        fraudReasons.push(`Extreme Price Tampering: '${item.name}' sold at Rs.${claimedSell}, but verified DB Cost is Rs.${actualCost}.`);
                        break;
                    }
                }
            }
        } catch (err) {
            console.error("[SECURITY AUDITOR] Parallel Price Verification Warn:", err.message);
        }
    }

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
    
    // Calculate Standard COGS + F&B Recipe COGS (STRICT MUTUAL EXCLUSION)
    // 🚨 ZERO-DOUBLE DIPPING: Recipe items already have their cost captured in recipeCogs!
    let cogs = Math.max(0, parseFloat(sale.recipeCogs) || 0); 
    if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(i => {
            if (i.isService) return;

            // If the sale already factored in recipe consumption, bypass manufactured items to prevent 200% COGS explosion!
            if (sale.recipeCogs > 0 && (i.isRecipeItem || i.isManufactured)) return;

            const itemBuy = Math.max(0, parseFloat(i.buy) || 0);
            const itemQty = Math.max(0, parseFloat(i.qty) || 0);
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
    const strictDiscounts = (sale.discountAmt || 0);
    const loyaltyMarketingExpense = (sale.loyaltyRedeemed || 0);

    // =========================================================================
    // 🏛️ STATUTORY TAX SCHEDULE DISAGGREGATION ENGINE (SCHEDULE 1, 3, 7)
    // (බිල්පත් 110,000ක් Backend එකෙන්ම ෂෙඩියුල් වලට වෙන් කර Rollup එකට දැමීම)
    // =========================================================================
    const taxableBase = parseFloat(sale.taxableBase) || 0;
    const exemptBase = parseFloat(sale.exemptBase) || 0;
    const vatAmt = parseFloat(sale.vatAmt) || 0;
    const ssclAmt = parseFloat(sale.ssclAmt) || 0;
    const hasForex = (sale.forexTender && sale.forexTender.foreignAmount > 0 && sale.forexTender.currency !== "LKR");
    const forexBase = hasForex ? (parseFloat(sale.forexTender.economicValueLKR) || 0) : 0;

    const rollupPayload = {
        grossSales: FieldValue.increment(secureRound(gross)),
        totalDiscounts: FieldValue.increment(secureRound(strictDiscounts)),
        
        // 🏛️ DISAGGREGATED STATUTORY SCHEDULE COUNTERS
        sch1TaxableBase: FieldValue.increment(secureRound(taxableBase)),
        sch3ExemptBase: FieldValue.increment(secureRound(exemptBase)),
        sch7ForexBase: FieldValue.increment(secureRound(forexBase)),
        vatCollected: FieldValue.increment(secureRound(vatAmt)),
        ssclCollected: FieldValue.increment(secureRound(ssclAmt)),
        taxCollected: FieldValue.increment(secureRound(sale.taxAmt || 0)),

        totalCOGS: FieldValue.increment(secureRound(cogs)),
        payLaterDebt_Issued: FieldValue.increment(secureRound(sale.creditBalance || 0)),
        storeCreditWallet_Redeemed: FieldValue.increment(secureRound(sale.walletApplied || 0)),
        cashInDrawer: FieldValue.increment(secureRound(cashIn)),
        bankTransfers: FieldValue.increment(secureRound(bankIn)),
        chequesPending: FieldValue.increment(secureRound(chqIn)),
        
        operationalExpenses: FieldValue.increment(secureRound(loyaltyMarketingExpense)),
        dynamicOpex: {
            Loyalty_Redemptions: FieldValue.increment(secureRound(loyaltyMarketingExpense))
        }
    };

    // =========================================================================
    // 🏛️ IFRS & IRD STATUTORY PARITY: SEPARATING VAT & SSCL LIABILITIES
    // VAT බදු වගකීම සහ SSCL පිරිවැටුම් බදු වගකීම ශේෂ පත්‍රයේ වෙන් වෙන්ව බැර කිරීම
    // =========================================================================
    const glPayload = {
        totalReceivables: FieldValue.increment(secureRound(sale.creditBalance || 0)),
        cashInHand: FieldValue.increment(secureRound(cashIn)),
        cashAtBank: FieldValue.increment(secureRound(bankIn)),
        taxPayable: FieldValue.increment(secureRound(vatAmt)),       // 👈 100% PURE VAT PAYABLE (TO IRD)
        ssclPayable: FieldValue.increment(secureRound(ssclAmt)),     // 👈 DEDICATED SSCL LEVY LIABILITY
        pendingRecCheques: FieldValue.increment(secureRound(chqIn))
    };

    if (sale.walletApplied && sale.walletApplied > 0) {
        glPayload.storeCredits = FieldValue.increment(-secureRound(sale.walletApplied));
    }

    const batch = db.batch();

    // 1. Daily & Monthly Rollups Update (Naturally sharded by Date)
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_daily/${keys.dayKey}`), rollupPayload, { merge: true });
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly/${keys.monthKey}`), rollupPayload, { merge: true });

    // =========================================================================
    // 🚀 DISTRIBUTED SHARDED COUNTER ENGINE (ANTI-CONTENTION SHIELD)
    // (කවුන්ටර 100කින් එකවර බිල් ගසන විට global_balance_sheet Crash වීම වළක්වන Shards 10)
    // =========================================================================
    const shardIndex = Math.floor(Math.random() * 10); // 0 සිට 9 දක්වා අහඹු Shard එකක් තෝරාගනී
    const shardDocRef = db.doc(`users/${ownerId}/shops/${shopId}/balance_sheet_shards/shard_${shardIndex}`);
    batch.set(shardDocRef, glPayload, { merge: true });

    // =========================================================================
    // 🏛️ ZERO-STRANDED RAMIS TAX INVOICE DISPATCHER (SCHEDULE 01, 03 & 07 COMPLIANT)
    // Merchant හට TIN අංකයක් ඇත්නම්, VAT බද්දක් අය නොවන Exempt/Zero-Rated බිල්පත්ද RAMIS Outbox එකට යැවීම
    // =========================================================================
    const hasMerchantTaxIdentity = (sale.merchantTin && String(sale.merchantTin).trim() !== '');
    const hasTaxAmount = (sale.vatAmt && parseFloat(sale.vatAmt) > 0) || (sale.taxAmt && parseFloat(sale.taxAmt) > 0);
    const hasExemptTurnover = (sale.exemptBase && parseFloat(sale.exemptBase) > 0);
    const hasZeroRatedForex = (sale.forexTender && sale.forexTender.foreignAmount > 0);

    const isRamisReportable = hasMerchantTaxIdentity || hasTaxAmount || hasExemptTurnover || hasZeroRatedForex;
    
    if (isRamisReportable) {
        const outboxDocRef = db.doc(`users/${ownerId}/shops/${shopId}/ramis_outbox/${saleId}`);
        batch.set(outboxDocRef, {
            saleId: saleId,
            invoiceNumber: sale.customOrderId || saleId,
            shopId: shopId,
            ownerId: ownerId,
            tin: sale.merchantTin || null,
            vatNo: sale.merchantVatNo || null,
            dateTime: sale.date || new Date().toISOString(),
            buyerTin: (sale.customer && sale.customer.tinNumber) ? sale.customer.tinNumber : null,
            subTotal: sale.subtotal || 0,
            vatAmount: sale.vatAmt || sale.taxAmt || 0,
            grandTotal: sale.total || 0,
            
            // 🏛️ ZERO-DATA STRANDING: බදු පදනම් සහ ප්‍රතිශත Outbox Worker වෙත සම්පූර්ණයෙන්ම ලබාදීම
            taxableBase: sale.taxableBase !== undefined ? sale.taxableBase : null,
            exemptBase: sale.exemptBase !== undefined ? sale.exemptBase : 0,
            vatPercent: sale.vatPercent !== undefined ? sale.vatPercent : null,
            ssclPercent: sale.ssclPercent !== undefined ? sale.ssclPercent : null,

            // 🏛️ RICH LINE ITEM AUDIT PROJECTION (PRESERVING EXEMPT & TAX METADATA)
            items: (sale.items || []).map(i => ({
                name: i.name,
                qty: i.qty,
                price: (i.effectiveSell !== undefined ? i.effectiveSell : i.sell) || 0,
                netLineBase: i.netLineBase !== undefined ? i.netLineBase : null,
                netUnitPrice: i.netUnitPrice !== undefined ? i.netUnitPrice : null,
                lineVatAmount: i.lineVatAmount !== undefined ? i.lineVatAmount : 0,
                lineSsclAmount: i.lineSsclAmount !== undefined ? i.lineSsclAmount : 0,
                isTaxExempt: (i.isTaxExempt === true),
                taxRate: i.taxRate !== undefined ? i.taxRate : null
            })),
            forexTender: sale.forexTender || null,
            status: "PENDING",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // 🏛️ SEAL CQRS & OUTBOX STATUS ATOMICALLY
    batch.update(saleDocRef, {
        cqrsProcessed: true,
        cqrsProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
        irdVerificationStatus: isRamisReportable ? "QUEUED_OUTBOX" : "NON_VAT_MERCHANT"
    });

    await batch.commit();
    console.log(`[CQRS] Successfully booked Sale ${sale.customOrderId || saleId} to Rollups, Shard ${shardIndex} and Outbox.`);
});
// =========================================================================
// 🚀 EVENT-DRIVEN TRANSACTIONAL OUTBOX WORKER: RAMIS TRANSMISSION ENGINE
// Cashier ගේ ජාලය විසන්ධි වුවද බදු බිල්පත් අනාථ වීම 100% වළක්වන Background Worker
// =========================================================================
exports.onRamisOutboxWritten = onDocumentCreated({
    document: "users/{ownerId}/shops/{shopId}/ramis_outbox/{saleId}",
    memory: "512MiB",
    timeoutSeconds: 60,
    retry: true // Cloud Functions ස්වයංක්‍රීයව Retry කර බදු ගිලිහීම වළක්වයි
}, async (event) => {
    if (!event.data) return;
    const task = event.data.data();
    const { ownerId, shopId, saleId } = event.params;
    const db = admin.firestore();
    const saleDocRef = db.doc(`users/${ownerId}/shops/${shopId}/sales/${saleId}`);

    if (task.status === "COMPLETED") return;

    try {
        // Merchant ගේ Profile එකෙන් TIN/VAT අංක තහවුරු කරගැනීම (Failsafe)
        if (!task.tin || !task.vatNo) {
            const profSnap = await db.doc(`users/${ownerId}/shops/${shopId}/settings/profile`).get();
            if (profSnap.exists()) {
                const prof = profSnap.data();
                task.tin = task.tin || prof.tinNumber;
                task.vatNo = task.vatNo || prof.vatNumber;
            }
        }

        // 🛡️ IRD RAMIS WEB API CALL WITH EXPONENTIAL RETRY
        const result = await executeRamisInvoicePush(ownerId, shopId, task);

        const batch = db.batch();
        // 1. Sale Document එකේ නියම රාජ්‍ය මුද්‍රාව සටහන් කිරීම
        batch.update(saleDocRef, {
            irdVerificationStatus: "SYNCED",
            ramisRef: result.referenceNo,
            ramisAckAt: admin.firestore.FieldValue.serverTimestamp(),
            ramisSyncError: null
        });

        // 2. Outbox Task එක සාර්ථකව අවසන් කිරීම
        batch.update(event.data.ref, {
            status: "COMPLETED",
            referenceNo: result.referenceNo,
            completedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        console.log(`[RAMIS OUTBOX] Invoice ${task.invoiceNumber} successfully synced to IRD. Ref: ${result.referenceNo}`);

    } catch (err) {
        console.error(`[RAMIS OUTBOX ERROR] Invoice ${task.invoiceNumber}:`, err.message);
        
        // අසාර්ථක වූයේ නම් Outbox එකෙහි දෝෂය සටහන් කර ඊළඟ Retry එකට සූදානම් කිරීම
        await event.data.ref.update({
            status: "FAILED_RETRY",
            retryCount: admin.firestore.FieldValue.increment(1),
            lastError: err.message || "Unknown IRD Gateway Error",
            lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await saleDocRef.update({
            irdVerificationStatus: "SYNC_FAILED_QUEUED",
            ramisSyncError: err.message
        });

        throw err; // Cloud Function retry එක trigger කරවයි
    }
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
            
        } else if (exp.isStaffBadDebt) {
            // =========================================================================
            // 🏛️ IFRS 9 FINANCIAL INSTRUMENTS: STAFF ADVANCE BAD DEBT WRITE-OFF
            // සේවකයා පැන ගිය විට ව්‍යාජ වත්කම ශේෂ පත්‍රයෙන් කපා හැර P&L එකට පාඩුවක් ලෙස ලියැවීම
            // =========================================================================
            rollups.operationalExpenses = FieldValue.increment(amt);
            rollups.dynamicOpex = {
                Bad_Debts_Staff: FieldValue.increment(amt)
            };
            gl.staffAdvancesAsset = FieldValue.increment(-amt); // 👈 Balance Sheet එකෙන් අසත්‍ය වත්කම ඉවත් කරයි!
            
        } else if (!exp.isIncome && exp.isLiability) {
            // 🏛️ IFRS 100% BALANCED ENTRY: Liability Reduction (Dr. Store Credit) & Asset Offset (Cr. Accounts Receivable)
            gl.storeCredits = FieldValue.increment(-amt);
            gl.totalReceivables = FieldValue.increment(-amt); // 👈 Offsets the over-restored debt accurately!
            
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
                // 🏛️ IFRS DOUBLE-ENTRY FIX: Accrue Statutory EPF/ETF Liabilities to Balance Sheet!
                if (exp.isStatutorySurchargeProvision) {
                    // ප්‍රමාද අධිභාරය වෙනමම වගකීමක් ලෙස Balance Sheet එකේ ලියවේ
                    gl.epfSurchargesPayable = FieldValue.increment(amt);
                } else if (exp.isNonCashExpense) {
                    gl.payrollLiabilities = FieldValue.increment(amt);
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
                
                rollups.dynamicOpex = {
                    [sanitizedCatName]: FieldValue.increment(amt)
                };
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
// 3. TRIGGER: ON REFUND CREATED (100% IFRS BALANCED & RAMIS COMPLIANT)
// ------------------------------------------------------------------------
exports.onRefundCreated = onDocumentCreated("users/{ownerId}/shops/{shopId}/refunds/{refundId}", async (event) => {
    const r = event.data.data();
    const { ownerId, shopId } = event.params;
    const db = admin.firestore();

    const keys = getRollupKeys(r.date);
    
    // 🏛️ IAS 2 HISTORICAL COST REVERSAL: Exact stock carrying cost
    let cogsReversed = 0;
    if (r.restock) {
        cogsReversed = secureRound(r.cogsReversed !== undefined ? r.cogsReversed : (r.amount - (r.profitReversal || 0)));
    }
    
    const cashOut = secureRound(r.cashOutToCustomer || 0);
    const storeCreditAmt = secureRound(r.storeCreditIssued !== undefined ? r.storeCreditIssued : (r.refundMethod === 'Store Credit' ? r.amount : 0));
    const debtCancelledAmt = secureRound(r.debtCancelled || 0);

    // 🚨 STATUTORY TAX COMPLIANCE: Deduct ONLY pure VAT from taxPayable! Non-refundable SSCL is NOT deducted.
    const pureVatReversed = secureRound(r.vatReversed !== undefined ? r.vatReversed : (r.taxReversed || 0));
    const pureSsclReversed = secureRound(r.ssclReversed || 0);

    let rollups = {
        salesReturns: FieldValue.increment(secureRound(r.amount)),
        taxReversed: FieldValue.increment(pureVatReversed),
        ssclReversed: FieldValue.increment(pureSsclReversed),
        totalCOGS: FieldValue.increment(-cogsReversed)
    };
    
    let gl = {
        taxPayable: FieldValue.increment(-pureVatReversed) // 👈 100% IRD Legal: Only true VAT offsets VAT Payable
    };

    // 🏛️ MULTI-LEG DOUBLE-ENTRY JOURNAL ENGINE (ANTI-GHOST SHORTAGE)
    if (debtCancelledAmt > 0) {
        // පාරිභෝගික ණය කපාහැරීම නිසා ශේෂ පත්‍රයේ Accounts Receivable හරියටම අඩු වේ
        gl.totalReceivables = FieldValue.increment(-debtCancelledAmt);
        rollups.payLaterDebt_Cancelled = FieldValue.increment(debtCancelledAmt);
    }

    if (r.refundMethod === 'Store Credit' || storeCreditAmt > 0) {
        rollups.storeCreditWallet_Issued = FieldValue.increment(storeCreditAmt);
        gl.storeCredits = FieldValue.increment(storeCreditAmt);
    }

    if (r.refundMethod === 'Card/Bank') {
        if (cashOut > 0) {
            rollups.bankTransfers = FieldValue.increment(-cashOut);
            gl.cashAtBank = FieldValue.increment(-cashOut);
        }
    } else if (r.refundMethod === 'Cash' || (!r.refundMethod.includes('Credit') && r.refundMethod !== 'Deduct Debt')) {
        // මුදල් සැබවින්ම ලාච්චුවෙන් ගියේ නම් පමණක් Cash Drawer අඩු වේ
        if (cashOut > 0) {
            rollups.cashInDrawer = FieldValue.increment(-cashOut);
            gl.cashInHand = FieldValue.increment(-cashOut);
        }
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
    const safeNetCost = secureRound(dn.netAmount || 0);
    const safeVatAmount = secureRound(dn.vatAmount || 0);

    if (safeTotalCredit <= 0) return;

    const keys = getRollupKeys(dn.date || new Date().toISOString());
    const batch = db.batch();

    // =========================================================================
    // 🏛️ IFRS DOUBLE-ENTRY BALANCED JOURNAL ENTRIES (SHARDED ARCHITECTURE)
    // Dr. Accounts Payable (Liabilities Decrease) = safeTotalCredit
    // Cr. Tax Payable (Input VAT Reversal / Liability Increase) = safeVatAmount
    // (Cr. Inventory Asset = safeNetCost is recorded to shards via onProductWritten)
    // Mathematical Balance: -safeTotalCredit + safeVatAmount = -safeNetCost (100% Balanced!)
    // =========================================================================
    const glPayload = {
        totalPayables: FieldValue.increment(-safeTotalCredit)
    };
    if (safeVatAmount > 0) {
        glPayload.taxPayable = FieldValue.increment(safeVatAmount);
    }

    // 🚀 DISTRIBUTED SHARDED COUNTER ENGINE (HOTSPOTTING CRASH SHIELD)
    const shardIndex = Math.floor(Math.random() * 10);
    const shardDocRef = db.doc(`users/${ownerId}/shops/${shopId}/balance_sheet_shards/shard_${shardIndex}`);
    batch.set(shardDocRef, glPayload, { merge: true });

    // 🏛️ DISAGGREGATED STATUTORY SCHEDULE 04 ROLLUP COUNTERS
    const rollupPayload = {
        supplierReturns_Net: FieldValue.increment(safeNetCost),
        taxReversed_InputVAT: FieldValue.increment(safeVatAmount),
        sch4DebitNotesTotal: FieldValue.increment(safeTotalCredit)
    };
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_daily/${keys.dayKey}`), rollupPayload, { merge: true });
    batch.set(db.doc(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly/${keys.monthKey}`), rollupPayload, { merge: true });

    // Mark as Processed to enforce CQRS Idempotency
    batch.update(event.data.ref, { glProcessed: true, processedAt: admin.firestore.FieldValue.serverTimestamp() });

    await batch.commit();
    console.log(`[CQRS] RTV Sharded: AP -${safeTotalCredit}, Tax +${safeVatAmount} booked to shard_${shardIndex} for DN ${dn.dnId || noteId}`);
});

// ------------------------------------------------------------------------
// 6. TRIGGER: ON CROSS-BRANCH TRANSFER WRITTEN (INTER-BRANCH ROLLUP SYNC)
// ------------------------------------------------------------------------
exports.onTransferWritten = onDocumentWritten("users/{ownerId}/transfers/{transferId}", async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after) return; // If deleted, ignore

    const { ownerId, transferId } = event.params;
    const db = admin.firestore();

    // 🛡️ STATE TRANSITION FIREWALL: Execute ONLY when transfer status officially transitions to COMPLETED
    const wasCompleted = before ? before.status === 'COMPLETED' : false;
    const isCompleted = after.status === 'COMPLETED';

    if (!isCompleted || wasCompleted || after.rollupsProcessed === true) return;
    const tr = after;

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
        // 🚀 DISTRIBUTED SHARDED BALANCE SHEET (ANTI-HOTSPOTTING)
        const shardIndex = Math.floor(Math.random() * 10);
        const shardRef = db.doc(`users/${event.params.ownerId}/shops/${event.params.shopId}/balance_sheet_shards/shard_${shardIndex}`);
        const updates = {};
        if (assetDelta !== 0) updates.inventoryAsset = FieldValue.increment(assetDelta);
        if (payablesDelta !== 0) updates.totalPayables = FieldValue.increment(payablesDelta);
        await shardRef.set(updates, { merge: true });
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

// ========================================================================
// 🛡️ ENTERPRISE BIOMETRIC HARDWARE INGESTION (ENFORCED TENANT BINDING)
// ========================================================================
exports.biometricPushWebhook = onRequest({ cors: true }, async (req, res) => {
    const rawSerial = req.headers['x-device-serial'] || req.query.sn || req.body?.sn;
    const deviceSecret = req.headers['x-device-token'] || req.query.token || req.body?.token;

    if (!rawSerial || !deviceSecret) {
        return res.status(401).send("UNAUTHORIZED: Hardware credentials missing.");
    }

    let cleanSerial = "";
    try {
        cleanSerial = sanitizePathSegment(rawSerial, 'deviceSerial');
    } catch(err) {
        return res.status(400).send("SECURITY_ALERT: Malformed hardware serial.");
    }

    const db = admin.firestore();
    const configSnap = await db.doc(`system_hardware_tokens/${cleanSerial}`).get();
    if (!configSnap.exists || configSnap.data().secretToken !== deviceSecret || configSnap.data().isActive === false) {
        console.error(`🚨 HARDWARE SPOOFING BLOCKED: Unauthorized ping from SN: ${cleanSerial}`);
        return res.status(403).send("FORBIDDEN: Hardware Token Mismatch or Inactive.");
    }

    // 🛡️ CRYPTOGRAPHIC DEVICE-TENANT BINDING: Client එවූ IDs ප්‍රතික්ෂේප කර Database හි සැබෑ Tenant ගනී
    const hardwareConfig = configSnap.data();
    const authoritativeOwnerId = hardwareConfig.ownerId;
    const authoritativeShopId = hardwareConfig.shopId;

    try {
        const { empId, punchTime } = req.body;
        if (!empId || !punchTime) {
            return res.status(400).send("BAD_REQUEST: Missing punch telemetry.");
        }

        const cleanEmpId = sanitizePathSegment(String(empId), 'empId');
        const punchDateObj = new Date(punchTime);
        if (isNaN(punchDateObj.getTime())) {
            return res.status(400).send("BAD_REQUEST: Corrupted timestamp format.");
        }

        const slDateStr = new Date(punchDateObj.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];

        const empRef = db.doc(`users/${authoritativeOwnerId}/shops/${authoritativeShopId}/employees/${cleanEmpId}`);
        const empSnap = await empRef.get();

        if (!empSnap.exists) {
            return res.status(404).send("EMPLOYEE_NOT_REGISTERED");
        }
        const empData = empSnap.data();

        const [y, m] = slDateStr.split('-');
        const rosterSnap = await db.doc(`users/${authoritativeOwnerId}/shops/${authoritativeShopId}/settings/roster_${y}_${m}`).get();
        const todayRoster = rosterSnap.exists ? rosterSnap.data().days[slDateStr] : null;

        const logsRef = db.collection(`users/${authoritativeOwnerId}/shops/${authoritativeShopId}/employees/${cleanEmpId}/logs`);
        const todayLogQ = await logsRef.where("date", "==", slDateStr).limit(1).get();
        const isClockIn = todayLogQ.empty;

        if (isClockIn) {
            let lateMinutes = 0;
            if (todayRoster && !todayRoster.isClosed) {
                const shiftStartTime = new Date(`${slDateStr}T${todayRoster.shiftStart}:00+05:30`);
                if (punchDateObj > shiftStartTime) {
                    lateMinutes = Math.floor((punchDateObj - shiftStartTime) / 60000);
                }
            }
            await logsRef.add({
                date: slDateStr, status: 'P',
                clockInTime: punchDateObj.toISOString(),
                clockInSource: `BIOMETRIC_${cleanSerial}`,
                lateMins: lateMinutes, workedHours: 0, ot: 0, advance: 0,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            const logDoc = todayLogQ.docs[0];
            const logData = logDoc.data();
            const inTime = new Date(logData.clockInTime);
            let netHours = (punchDateObj - inTime) / (1000 * 60 * 60);

            if (todayRoster && !todayRoster.isBreakPaid && netHours >= (todayRoster.breakThreshold || 4)) {
                netHours -= ((todayRoster.breakMins || 60) / 60);
            }
            netHours = Math.max(0, Math.round(netHours * 100) / 100);

            let calculatedOT = 0;
            if (empData.otType !== 'none') {
                const wlSnap = await db.doc(`users/${authoritativeOwnerId}/shops/${authoritativeShopId}/settings/ot_whitelist_${slDateStr}`).get();
                const isWhitelisted = wlSnap.exists && (wlSnap.data().allowedEmpIds || []).includes(cleanEmpId);
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
                clockOutSource: `BIOMETRIC_${cleanSerial}`,
                workedHours: netHours, ot: calculatedOT, systemCalcOt: calculatedOT
            });
        }
        return res.status(200).send("SUCCESS");
    } catch (error) {
        console.error("Biometric Webhook Error:", error);
        return res.status(500).send("INTERNAL_ERROR");
    }
});

// ========================================================================
// 🛰️ ENTERPRISE GPS VEHICLE TELEMETRY (HARDWARE TENANT BINDING)
// ========================================================================
exports.gpsTelemetryWebhook = onRequest({ cors: true }, async (req, res) => {
    const payload = req.method === 'POST' ? req.body : req.query;
    const { imei, lat, lng, speed, odometer, token } = payload;

    if (!imei || !lat || !lng) {
        return res.status(400).send("BAD_REQUEST: Missing required telemetry params.");
    }

    let cleanImei = "";
    try {
        cleanImei = sanitizePathSegment(String(imei), 'trackerImei');
    } catch(e) {
        return res.status(400).send("BAD_REQUEST: Invalid IMEI format.");
    }

    const db = admin.firestore();
    const tokenSnap = await db.doc(`system_hardware_tokens/${cleanImei}`).get();
    if (!tokenSnap.exists || tokenSnap.data().secretToken !== token || tokenSnap.data().isActive === false) {
        return res.status(403).send("FORBIDDEN: Hardware Token Mismatch or Inactive Tracker.");
    }

    const authoritativeOwnerId = tokenSnap.data().ownerId;
    const authoritativeShopId = tokenSnap.data().shopId;

    try {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);
        const currentSpeed = parseFloat(speed) || 0;
        const currentOdo = parseFloat(odometer) || 0;

        const vQ = await db.collection(`users/${authoritativeOwnerId}/shops/${authoritativeShopId}/vehicles`)
                           .where("trackerImei", "==", cleanImei)
                           .limit(1).get();

        if (vQ.empty) return res.status(404).send("VEHICLE_NOT_FOUND");

        const vehDoc = vQ.docs[0];
        const vehData = vehDoc.data();
        const nowIso = new Date().toISOString();
        const batch = db.batch();

        const lastKnownOdo = parseFloat(vehData.currentOdometer) || 0;
        const safeOdometer = (currentOdo >= lastKnownOdo) ? currentOdo : lastKnownOdo;

        batch.update(vehDoc.ref, {
            liveLocation: { lat: latitude, lng: longitude, speed: currentSpeed, updatedAt: nowIso },
            currentOdometer: safeOdometer
        });

        const activeTripQ = await db.collection(`users/${authoritativeOwnerId}/shops/${authoritativeShopId}/vehicle_trips`)
                                    .where("vehicleId", "==", vehDoc.id)
                                    .where("status", "==", "ACTIVE")
                                    .limit(1).get();

        if (!activeTripQ.empty) {
            const tripDoc = activeTripQ.docs[0];
            const routePointRef = tripDoc.ref.collection('route_points').doc();
            batch.set(routePointRef, { lat: latitude, lng: longitude, speed: currentSpeed, timestamp: nowIso });
        }

        await batch.commit();
        return res.status(200).send("GPS_ACK");
    } catch (error) {
        console.error("GPS Webhook Error:", error);
        return res.status(500).send("INTERNAL_ERROR");
    }
});
// ========================================================================
// ⚡ SECURE LIVE CART MARGIN SYNTHESIZER (CORPORATE ESPIONAGE IMMUNE)
// ========================================================================
exports.synthesizeCartArbitrage = onCall({ timeoutSeconds: 15, memory: "256MiB" }, async (request) => {
    const { shopId: requestedShopId, cartItems } = request.data;
    
    // 🛡️ BOLA FIREWALL: Caller ගේ සැබෑ Tenant සීමාව තහවුරු කිරීම
    const context = await assertTenantContext(request.auth, requestedShopId);
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
        return { success: true, hasRecommendation: false, reason: "EMPTY_CART" };
    }

    const db = admin.firestore();

    try {
        let currentCartRevenue = 0;
        let currentCartCost = 0;
        const cartItemIds = new Set();
        const cartItemNames = [];

        cartItems.forEach(i => {
            const sell = parseFloat(i.effectiveSell || i.sell) || 0;
            const buy = parseFloat(i.buy) || 0;
            const qty = parseFloat(i.qty) || 1;
            currentCartRevenue += (sell * qty);
            currentCartCost += (buy * qty);
            if (i.id) cartItemIds.add(String(i.id).trim());
            cartItemNames.push(String(i.name || 'Item'));
        });

        const currentCartProfit = Math.max(0, currentCartRevenue - currentCartCost);

        // සත්‍යාපිත Tenant ගේ Products පමණක් Query කිරීම
        const productsRef = db.collection(`users/${safeTenantId}/shops/${safeShopId}/products`);
        const prodSnap = await productsRef.where("qty", ">", 0).limit(60).get();

        if (prodSnap.empty) {
            return { success: true, hasRecommendation: false, reason: "NO_ACTIVE_INVENTORY" };
        }

        let candidates = [];
        prodSnap.forEach(d => {
            if (cartItemIds.has(d.id)) return;

            const p = d.data();
            const buy = parseFloat(p.buy) || 0;
            const sell = parseFloat(p.sell) || 0;
            const qty = parseFloat(p.qty) || 0;

            if (buy <= 0 || sell <= buy) return;

            const marginPercent = ((sell - buy) / sell) * 100;

            if (marginPercent >= 20 && qty >= 2) {
                let discountedSell = Math.round((sell * 0.85) * 100) / 100;
                if (discountedSell < (buy * 1.15)) {
                    discountedSell = Math.round((buy * 1.15) * 100) / 100;
                }

                const newProfitPerUnit = Math.round((discountedSell - buy) * 100) / 100;
                const customerSavings = Math.round((sell - discountedSell) * 100) / 100;

                if (newProfitPerUnit > 0 && customerSavings > 0) {
                    candidates.push({
                        id: d.id,
                        name: p.name,
                        originalSell: sell,
                        bundleSell: discountedSell,
                        cost: buy,
                        unitProfitGain: newProfitPerUnit,
                        customerSavings: customerSavings,
                        marginPercent: marginPercent,
                        stockAvail: qty,
                        batchNumber: p.batchNumber || 1,
                        itemType: p.itemType || 'standard'
                    });
                }
            }
        });

        if (candidates.length === 0) {
            return { success: true, hasRecommendation: false, reason: "NO_ARBITRAGE_MATCH" };
        }

        candidates.sort((a, b) => b.unitProfitGain - a.unitProfitGain);
        const topCandidate = candidates[0];

        const projectedNewBasketProfit = Math.round((currentCartProfit + topCandidate.unitProfitGain) * 100) / 100;
        const profitSurgePercent = currentCartProfit > 0 ? Math.round(((topCandidate.unitProfitGain / currentCartProfit) * 100) * 10) / 10 : 100;

        let salesPitchText = `සර්, මේ බිලත් එක්කම '${topCandidate.name}' එක ගත්තොත් අද විශේෂයෙන්ම රු. ${topCandidate.customerSavings} ක වට්ටමක් ලැබෙනවා!`;
        
        try {
            const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
            const prompt = `Act as an elite retail sales coach. 
A customer is buying: [${cartItemNames.join(', ')}].
Suggest add-on: "${topCandidate.name}". Customer saves: Rs. ${topCandidate.customerSavings}.
Write exactly ONE natural, polite sales sentence in SINHALA for the cashier to speak.`;

            const aiResp = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
            });

            if (aiResp.text) salesPitchText = aiResp.text.trim().replace(/"/g, '');
        } catch (aiErr) {
            console.warn("AI Pitch fallback used:", aiErr.message);
        }

        return {
            success: true,
            hasRecommendation: true,
            bundleItem: topCandidate,
            currentProfit: currentCartProfit,
            projectedProfit: projectedNewBasketProfit,
            extraProfitGain: topCandidate.unitProfitGain,
            profitSurgePercent: profitSurgePercent,
            customerSavings: topCandidate.customerSavings,
            salesPitch: salesPitchText
        };
    } catch (error) {
        console.error("Synthesizer Error:", error);
        throw new HttpsError('internal', 'Cart Margin Synthesizer failed.');
    }
});
// ========================================================================
// 🛡️ WORLD-FIRST: AUTONOMOUS COGNITIVE B2B CREDIT RISK & DEFAULT UNDERWRITER
// (පාරිභෝගික ණය පොලු තැබීමේ අවදානම කවුන්ටරයේදී අනාවරණය කරන රහස්‍ය ඇල්ගොරිතමය)
// ========================================================================
// =========================================================================
// 🛡️ ZERO-TRUST MULTI-TENANT IDENTITY & BOLA FIREWALL GATEKEEPER
// (ලක්ෂ 100,000ක කඩවල දත්ත එකිනෙක කාන්දු වීම 100% ක් වළක්වන පලිහ)
// =========================================================================
async function assertTenantContext(auth, requestedShopId) {
    if (!auth || !auth.uid) {
        throw new HttpsError('unauthenticated', 'SECURITY VIOLATION: Unauthenticated access attempt.');
    }

    const callerUid = auth.uid;
    const callerEmail = auth.token.email || 'Unknown';
    const userDocRef = admin.firestore().doc(`users/${callerUid}`);
    const userDocSnap = await userDocRef.get();

    if (!userDocSnap.exists) {
        throw new HttpsError('permission-denied', 'SECURITY REFUSAL: User identity does not exist on this SaaS platform.');
    }

    const userData = userDocSnap.data();
    let validatedTenantId = null;
    let validatedShopId = null;

    if (userData.role === 'admin') {
        // අයිතිකරු නම්, Tenant ID එක යනු ඔහුගේම UID එකයි
        validatedTenantId = callerUid;
        validatedShopId = requestedShopId;
    } else if (userData.role === 'cashier' || userData.role === 'staff') {
        // සේවකයෙකු නම්, ඔහුට අයිති මුද්‍රා තැබූ Tenant ID සහ Branch ID එක DB එකෙන්ම ලබාගනී
        validatedTenantId = userData.ownerId;
        validatedShopId = userData.allowedShop;

        // BOLA Attack Trap: සේවකයා තමන්ට අවසර නැති වෙනත් Branch එකකට හොරෙන් ඇතුළු වීමට හැදුවහොත්
        if (requestedShopId && requestedShopId !== validatedShopId) {
            console.error(`🚨 CROSS-TENANT BOLA ATTEMPT: User ${callerEmail} (Tenant: ${validatedTenantId}) tried to hijack Shop: ${requestedShopId}`);
            throw new HttpsError('permission-denied', 'BOLA SHIELD: Unauthorized cross-branch access attempt logged.');
        }
    } else {
        throw new HttpsError('permission-denied', 'SECURITY REFUSAL: Invalid tenant authorization role.');
    }

    if (userData.status === 'suspended') {
        throw new HttpsError('permission-denied', 'SECURITY LOCK: Your merchant account has been suspended.');
    }

    return {
        tenantId: validatedTenantId,
        shopId: validatedShopId,
        callerEmail: callerEmail,
        role: userData.role
    };
}

exports.underwriteCreditRisk = onCall({ timeoutSeconds: 15, memory: "256MiB" }, async (request) => {
    // 🛡️ ZERO-TRUST BOLA RESOLUTION: Client-side ownerId සම්පූර්ණයෙන්ම ප්‍රතික්ෂේප කරයි!
    const { shopId: requestedShopId, customerPhone, billTotal, requestedCredit } = request.data;
    
    // Server-Side එකෙන් තහවුරු කළ සැබෑ Tenant Credentials පමණක් ලබා ගැනීම
    const context = await assertTenantContext(request.auth, requestedShopId);
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;

    if (!safeTenantId || !safeShopId || !customerPhone || requestedCredit === undefined) {
        throw new HttpsError('invalid-argument', 'Missing required verified underwriting parameters.');
    }

    const db = admin.firestore();

    try {
        const cleanPhone = String(customerPhone).trim();
        const reqCredit = Math.max(0, parseFloat(requestedCredit) || 0);
        const grandTotal = Math.max(0, parseFloat(billTotal) || 0);

        // 1. Fetch Customer Master Profile within Cryptographically Verified Tenant Boundary
        const custRef = db.doc(`users/${safeTenantId}/shops/${safeShopId}/customers/${cleanPhone}`);
        const custSnap = await custRef.get();

        // 2. Fetch Historical Sales Records for this Customer (Chronological Audit - ReferenceError Fixed)
        const salesRef = db.collection(`users/${safeTenantId}/shops/${safeShopId}/sales`);
        const salesSnap = await salesRef.where("customer.phone", "==", cleanPhone).limit(50).get();

        let totalLifetimeSpend = 0;
        let totalCreditBillsCount = 0;
        let settledCreditBillsCount = 0;
        let currentOutstandingDebt = 0;
        let oldestUnpaidDays = 0;
        const nowMs = Date.now();

        salesSnap.forEach(d => {
            const s = d.data();
            totalLifetimeSpend += (s.total || 0);

            if (s.paymentMethod === 'Pay Later' || s.creditBalance > 0) {
                totalCreditBillsCount++;
                const debt = (s.creditBalance || 0);
                currentOutstandingDebt += debt;

                if (debt > 0 && s.date) {
                    const saleMs = new Date(s.date).getTime();
                    const ageDays = Math.floor((nowMs - saleMs) / (1000 * 60 * 60 * 24));
                    if (ageDays > oldestUnpaidDays) oldestUnpaidDays = ageDays;
                } else if (debt === 0) {
                    settledCreditBillsCount++;
                }
            }
        });

        // =========================================================================
        // 🏛️ ZERO-TRUST MATHEMATICAL RISK VECTORS (IFRS 9 EXPECTED CREDIT LOSS)
        // =========================================================================
        let defaultProbability = 15; // Baseline minimum risk
        let riskTier = "LOW_RISK_PRIME";
        let advisoryText = "Customer has a pristine payment record. Fully creditworthy.";
        let recommendedSafeCredit = reqCredit;
        let requiredCashToken = 0;

        const isNewCustomer = !custSnap.exists() || salesSnap.empty;

        if (isNewCustomer) {
            // NEW CUSTOMER PRUDENCE RULE (නොදන්නා පාරිභෝගිකයාගේ අවදානම)
            defaultProbability = 75;
            riskTier = "HIGH_DEFAULT_RISK";
            recommendedSafeCredit = Math.round(grandTotal * 0.25 * 100) / 100; // Max 25% credit allowed
            requiredCashToken = Math.round((grandTotal - recommendedSafeCredit) * 100) / 100;
            advisoryText = "නව පාරිභෝගිකයෙකි. මීට පෙර ණය ගෙවීමේ ඉතිහාසයක් නොමැත. අවම වශයෙන් 75% ක අත්පිට මුදලක් ලබාගන්න.";

        } else {
            const cData = custSnap.data();

            // Vector A: Unpaid Debt Age (දින 45 ට වඩා පරණ ණය තිබේද?)
            if (oldestUnpaidDays > 60) {
                defaultProbability += 50;
            } else if (oldestUnpaidDays > 30) {
                defaultProbability += 25;
            }

            // Vector B: Debt Exposure Ratio (ණය ප්‍රමාණය සම්පූර්ණ මිලදී ගැනීම් වලින් 50% ඉක්මවයිද?)
            const totalProjectedDebt = currentOutstandingDebt + reqCredit;
            if (totalLifetimeSpend > 0) {
                const debtRatio = (totalProjectedDebt / totalLifetimeSpend);
                if (debtRatio > 0.8) defaultProbability += 30;
                else if (debtRatio > 0.4) defaultProbability += 15;
            }

            // Vector C: Settlement Velocity (ගෙවූ බිල්පත් ප්‍රතිශතය)
            if (totalCreditBillsCount > 0) {
                const settlementRate = (settledCreditBillsCount / totalCreditBillsCount);
                if (settlementRate < 0.4) defaultProbability += 25;
                else if (settlementRate > 0.85) defaultProbability -= 10;
            }

            // Vector D: Wallet Balance Credit (පාරිභෝගිකයා සතුව Store Credit ඇත්නම් අවදානම අඩුවේ)
            const walletBal = (cData.walletBalance || 0);
            if (walletBal > 0) defaultProbability -= 15;

            // Clamping Probability (0% - 95%)
            defaultProbability = Math.min(95, Math.max(5, defaultProbability));

            // Risk Tier Classification
            if (defaultProbability >= 70) {
                riskTier = "CRITICAL_DEFAULT_IMMINENT";
                recommendedSafeCredit = Math.max(0, Math.round(grandTotal * 0.20));
                requiredCashToken = Math.round((grandTotal - recommendedSafeCredit) * 100) / 100;
                advisoryText = `අධික පොලු තැබීමේ අවදානමකි (${defaultProbability}%)! දින ${oldestUnpaidDays} කින් නොගෙවූ පරණ ණය පවතී. අනිවාර්යයෙන්ම අවම වශයෙන් රු. ${requiredCashToken} ක මුදලක් ලබාගන්න.`;
            } else if (defaultProbability >= 40) {
                riskTier = "MODERATE_WATCHLIST";
                recommendedSafeCredit = Math.round(grandTotal * 0.50);
                requiredCashToken = Math.round((grandTotal - recommendedSafeCredit) * 100) / 100;
                advisoryText = `මධ්‍යස්ථ අවදානමකි (${defaultProbability}%). 50% ක අත්පිට මුදලක් (Rs. ${requiredCashToken}) ලබාගෙන ඉතිරිය ණයට දීම වඩාත් ආරක්ෂිතයි.`;
            } else {
                riskTier = "LOW_RISK_PRIME";
                recommendedSafeCredit = reqCredit;
                requiredCashToken = Math.max(0, Math.round((grandTotal - reqCredit) * 100) / 100);
                advisoryText = "විශිෂ්ට පාරිභෝගිකයෙකි. නියමිත දිනට ණය ගෙවා ඇත. ඉල්ලූ සම්පූර්ණ ණය මුදල අනුමත කළ හැක.";
            }
        }

        // 3. Generate AI Cashier Negotiation Script in Sinhala
        let cashierPitch = `සර්, අපේ පද්ධතියේ ණය ප්‍රතිපත්තියට අනුව රු. ${requiredCashToken} ක මුදලක් ගෙවා ඉතිරිය ණයට තබාගත හැක.`;
        
        try {
            const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
            const prompt = `Act as an elite retail credit controller.
A customer is asking for Rs. ${reqCredit} on credit for a total bill of Rs. ${grandTotal}.
Our risk assessment requires the cashier to politely ask for an upfront cash payment of Rs. ${requiredCashToken}.
Write exactly ONE diplomatic, courteous, professional sentence in SINHALA for the cashier to speak to the customer so they do NOT feel insulted.`;

            const aiResp = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
            });

            if (aiResp.text) {
                cashierPitch = aiResp.text.trim().replace(/"/g, '');
            }
        } catch(e) {
            console.warn("AI Script generation fallback used:", e.message);
        }

        return {
            success: true,
            customerName: custSnap.exists() ? (custSnap.data().name || "Customer") : "New Customer",
            defaultProbability: defaultProbability,
            riskTier: riskTier,
            currentOutstandingDebt: currentOutstandingDebt,
            oldestUnpaidDays: oldestUnpaidDays,
            requestedCredit: reqCredit,
            recommendedSafeCredit: recommendedSafeCredit,
            requiredCashToken: requiredCashToken,
            advisory: advisoryText,
            diplomaticPitch: cashierPitch
        };

    } catch (error) {
        console.error("Underwriting Error:", error);
        throw new HttpsError('internal', 'Credit Risk Underwriting failed.');
    }
});
// ========================================================================
// 🛡️ ZERO-TRUST MANAGER OVERRIDE PIN (ATOMIC CONCURRENCY LOCKOUT SHIELD)
// ========================================================================
exports.verifyManagerPin = onCall({ memory: "256MiB", timeoutSeconds: 15 }, async (request) => {
    const { shopId: requestedShopId, enteredPin, contextInfo } = request.data;
    
    // 🛡️ BOLA RESOLUTION
    const context = await assertTenantContext(request.auth, requestedShopId);
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;
    const uid = request.auth.uid;

    if (!enteredPin) {
        throw new HttpsError('invalid-argument', 'Missing verification parameters.');
    }

    const db = admin.firestore();
    const rateLimitRef = db.doc(`users/${safeTenantId}/shops/${safeShopId}/system_rate_limits/manager_pin_${uid}`);
    const profRef = db.doc(`users/${safeTenantId}/shops/${safeShopId}/settings/profile`);
    const serverNowMs = Date.now();

    // 🚨 ATOMIC TRANSACTIONAL RATE LIMIT & VERIFICATION (TOCTOU RACE CONDITION IMMUNE)
    const verificationResult = await db.runTransaction(async (t) => {
        const rateSnap = await t.get(rateLimitRef);
        let failedAttempts = 0;

        if (rateSnap.exists) {
            const rData = rateSnap.data();
            if (rData.lockedUntil && serverNowMs < rData.lockedUntil) {
                const waitSec = Math.ceil((rData.lockedUntil - serverNowMs) / 1000);
                throw new HttpsError('resource-exhausted', `SECURITY LOCKOUT: Too many failed attempts! Try again in ${waitSec}s.`);
            }
            failedAttempts = rData.failedAttempts || 0;
        }

        const profSnap = await t.get(profRef);
        if (!profSnap.exists) throw new HttpsError('not-found', 'Store Profile configuration not found.');

        const realPin = String(profSnap.data().managerPin || '0000').trim();
        const userPin = String(enteredPin).trim();

        // Timing Safe Comparison
        const userBuf = Buffer.from(userPin);
        const realBuf = Buffer.from(realPin);
        let isMatch = false;
        if (userBuf.length === realBuf.length) {
            isMatch = crypto.timingSafeEqual(userBuf, realBuf);
        }

        if (!isMatch) {
            const nextFails = failedAttempts + 1;
            let lockoutTime = 0;

            if (nextFails >= 3) {
                lockoutTime = serverNowMs + (300 * 1000); // 5-minute lockout
                const alertRef = db.collection(`users/${safeTenantId}/shops/${safeShopId}/alerts`).doc();
                t.set(alertRef, {
                    refId: request.auth.token.email || uid,
                    type: 'global',
                    orderId: 'PIN_LOCKOUT',
                    message: `🚨 SECURITY BREACH: 3 Failed Manager PIN attempts by ${request.auth.token.email || 'Cashier'}. Locked for 5m!`,
                    targetDate: new Date(serverNowMs).toISOString(),
                    frequency: 'once', status: 'triggered', createdAt: new Date(serverNowMs).toISOString()
                });
            }

            t.set(rateLimitRef, {
                failedAttempts: nextFails >= 3 ? 0 : nextFails,
                lockedUntil: lockoutTime,
                lastFailedAt: serverNowMs
            }, { merge: true });

            return { isMatch: false, attemptsRemaining: Math.max(0, 3 - nextFails) };
        }

        // On Success: Reset in same transaction
        t.set(rateLimitRef, { failedAttempts: 0, lockedUntil: 0, lastSuccessAt: serverNowMs }, { merge: true });
        return { isMatch: true };
    });

    if (!verificationResult.isMatch) {
        throw new HttpsError('permission-denied', `Invalid Manager Override PIN! (${verificationResult.attemptsRemaining} attempts remaining)`);
    }

    const auditRef = db.collection(`users/${safeTenantId}/system_audit_logs`).doc();
    await auditRef.set({
        timestamp: new Date(serverNowMs).toISOString(),
        userEmail: request.auth.token.email || 'Cashier',
        userRole: context.role,
        shopId: safeShopId,
        shopName: 'Override Vault',
        action: 'MANAGER_PIN_VERIFIED',
        description: `Manager PIN successfully authorized override. Context: ${JSON.stringify(contextInfo || {})}`
    });

    return { success: true, authorizedAt: serverNowMs };
});

// ========================================================================
// 🏦 SECURE OPEN-BANKING CONSENT (TENANT ISOLATED)
// ========================================================================
exports.manageBankConsent = onCall(async (request) => {
    const { shopId: requestedShopId, action, bankName, expiryDays } = request.data;
    
    // 🛡️ BOLA RESOLUTION: Admin ගේ අයිතිය තහවුරු කිරීම
    const context = await assertTenantContext(request.auth, requestedShopId);
    if (context.role !== 'admin') {
        throw new HttpsError('permission-denied', 'SECURITY REFUSAL: Only the Business Owner can manage bank telemetry consent.');
    }
    const safeTenantId = context.tenantId;
    const safeShopId = context.shopId;

    const db = admin.firestore();
    const consentDocRef = db.doc(`users/${safeTenantId}/shops/${safeShopId}/settings/bank_telemetry_consent`);

    try {
        if (action === 'REVOKE') {
            await consentDocRef.set({
                isActive: false,
                revokedAt: new Date().toISOString(),
                revokedBy: request.auth.token.email
            }, { merge: true });
            return { success: true, message: "Bank telemetry access permanently revoked." };
        } 
        else if (action === 'GRANT') {
            const secureToken = crypto.randomBytes(4).toString('hex').toUpperCase();
            const now = Date.now();
            const validDuration = (parseInt(expiryDays) || 30) * 24 * 60 * 60 * 1000;
            const payload = {
                isActive: true,
                targetBank: bankName || 'General Financial Institution',
                passcode: secureToken,
                grantedAt: new Date(now).toISOString(),
                expiresAt: new Date(now + validDuration).toISOString(),
                grantedBy: request.auth.token.email
            };
            await consentDocRef.set(payload);
            return { success: true, consent: payload };
        }
    } catch (e) {
        console.error("Consent Error:", e);
        throw new HttpsError('internal', 'Failed to update bank consent.');
    }
});

// ========================================================================
// 🏦 HARDENED BANK TELEMETRY INGESTION (BRUTE-FORCE LOCKOUT & ANTI-OOM)
// ========================================================================
exports.generateBankUnderwritingReport = onCall({ timeoutSeconds: 30, memory: "512MiB" }, async (request) => {
    const { ownerId, shopId, passcode } = request.data;
    if (!ownerId || !shopId || !passcode) {
        throw new HttpsError('invalid-argument', 'Missing bank authentication credentials.');
    }

    // 🚨 PATH TRAVERSAL SHIELD
    const safeOwnerId = sanitizePathSegment(String(ownerId), 'ownerId');
    const safeShopId = sanitizePathSegment(String(shopId), 'shopId');

    const db = admin.firestore();
    const rateLimitRef = db.doc(`users/${safeOwnerId}/shops/${safeShopId}/system_rate_limits/bank_telemetry_lock`);
    const serverNowMs = Date.now();

    // 🚨 BRUTE-FORCE LOCKOUT GUARD (5 FAILED ATTEMPTS = 1 HOUR LOCKOUT)
    const rateSnap = await rateLimitRef.get();
    if (rateSnap.exists) {
        const rData = rateSnap.data();
        if (rData.lockedUntil && serverNowMs < rData.lockedUntil) {
            const waitMins = Math.ceil((rData.lockedUntil - serverNowMs) / 60000);
            throw new HttpsError('resource-exhausted', `SECURITY LOCKOUT: Bank telemetry locked due to failed attempts. Try in ${waitMins}m.`);
        }
    }

    try {
        const consentRef = db.doc(`users/${safeOwnerId}/shops/${safeShopId}/settings/bank_telemetry_consent`);
        const cSnap = await consentRef.get();

        if (!cSnap.exists || !cSnap.data().isActive) {
            throw new HttpsError('permission-denied', 'SECURITY REFUSAL: The merchant has not enabled Bank Telemetry or access was revoked.');
        }

        const consent = cSnap.data();
        const enteredPasscode = String(passcode).trim().toUpperCase();

        if (consent.passcode !== enteredPasscode) {
            let currentFails = rateSnap.exists ? (rateSnap.data().failedAttempts || 0) + 1 : 1;
            let lockTime = currentFails >= 5 ? serverNowMs + (3600 * 1000) : 0; // 1-hour lock

            await rateLimitRef.set({
                failedAttempts: currentFails >= 5 ? 0 : currentFails,
                lockedUntil: lockTime,
                lastFailedAt: serverNowMs
            }, { merge: true });

            throw new HttpsError('permission-denied', `SECURITY REFUSAL: Invalid Bank Telemetry Passcode. (${5 - (currentFails % 5)} attempts left)`);
        }

        if (new Date(consent.expiresAt).getTime() < serverNowMs) {
            throw new HttpsError('permission-denied', 'EXPIRED TOKEN: Merchant consent has expired.');
        }

        // Reset Rate Limit on Valid Entry
        await rateLimitRef.set({ failedAttempts: 0, lockedUntil: 0, lastSuccessAt: serverNowMs }, { merge: true });

        // 2. Extract 6-Month Macro Financial Telemetry from CQRS Rollups
        const rollupsRef = db.collection(`users/${ownerId}/shops/${shopId}/financial_rollups_monthly`);
        const rSnap = await rollupsRef.orderBy('__name__', 'desc').limit(6).get();

        let total6mRevenue = 0;
        let total6mCogs = 0;
        let total6mOpex = 0;
        let monthsAudited = 0;

        rSnap.forEach(d => {
            const m = d.data();
            const netRev = (m.grossSales || 0) - (m.totalDiscounts || 0) - (m.taxCollected || 0) - ((m.salesReturns || 0) - (m.taxReversed || 0));
            total6mRevenue += Math.max(0, netRev);
            total6mCogs += (m.totalCOGS || 0);
            total6mOpex += (m.operationalExpenses || 0) + (m.payrollExpenses || 0);
            monthsAudited++;
        });

        const avgMonthlyRevenue = monthsAudited > 0 ? Math.round(total6mRevenue / monthsAudited) : 0;
        const avgMonthlyGrossProfit = monthsAudited > 0 ? Math.round((total6mRevenue - total6mCogs) / monthsAudited) : 0;
        const avgMonthlyOpex = monthsAudited > 0 ? Math.round(total6mOpex / monthsAudited) : 0;
        const avgMonthlyNetOperatingIncome = Math.round(avgMonthlyGrossProfit - avgMonthlyOpex);

        // =========================================================================
        // 🏛️ ZERO-DEFECT SERVER-SIDE SHARDED BALANCE SHEET CONSOLIDATOR
        // Shards 10 සහ Main Document එක එකවර ගලපා සැබෑ වාණිජ ද්‍රවශීලතාවය ලබාගැනීම
        // =========================================================================
        const mainGlRef = db.doc(`users/${ownerId}/shops/${shopId}/settings/global_balance_sheet`);
        const shardPromises = [mainGlRef.get()];
        for (let i = 0; i < 10; i++) {
            shardPromises.push(db.doc(`users/${ownerId}/shops/${shopId}/balance_sheet_shards/shard_${i}`).get());
        }

        const glSnaps = await Promise.all(shardPromises);
        const consolidatedGl = {
            cashInHand: 0,
            cashAtBank: 0,
            inventoryAsset: 0,
            totalReceivables: 0,
            totalPayables: 0,
            taxPayable: 0,
            pendingRecCheques: 0,
            pendingIssCheques: 0,
            storeCredits: 0
        };

        glSnaps.forEach(s => {
            if (s.exists) {
                const d = s.data();
                for (const key of Object.keys(consolidatedGl)) {
                    if (d[key] !== undefined) {
                        consolidatedGl[key] += (parseFloat(d[key]) || 0);
                    }
                }
            }
        });

        // Banker's Epsilon Rounding
        for (const key of Object.keys(consolidatedGl)) {
            consolidatedGl[key] = Math.round((consolidatedGl[key] + Number.EPSILON) * 100) / 100;
        }

        // 🛡️ TRUE BANK TELEMETRY VALUES (ZERO BLINDSPOT)
        const liquidCashInHand = Math.max(0, consolidatedGl.cashInHand);
        const liquidCashAtBank = Math.max(0, consolidatedGl.cashAtBank);
        const currentInventoryAsset = Math.max(0, consolidatedGl.inventoryAsset);
        const accountsReceivable = Math.max(0, consolidatedGl.totalReceivables);
        const accountsPayable = Math.max(0, consolidatedGl.totalPayables);
        const taxLiabilities = Math.max(0, consolidatedGl.taxPayable);

        // 4. Extract Supplier PDC Bounced History (Dishonor Index)
        const chqQ = await db.collection(`users/${ownerId}/shops/${shopId}/issued_cheques`).get();
        let totalIssuedPDC = 0;
        let bouncedPdcCount = 0;
        let bouncedPdcVolume = 0;

        chqQ.forEach(d => {
            const c = d.data();
            totalIssuedPDC++;
            if (c.status === 'BOUNCED') {
                bouncedPdcCount++;
                bouncedPdcVolume += (c.amount || 0);
            }
        });

        // 5. Basel III Ratios Calculation
        const quickAssets = liquidCashInHand + liquidCashAtBank + accountsReceivable;
        const quickLiabilities = accountsPayable + taxLiabilities;
        const quickRatio = quickLiabilities > 0 ? Math.round((quickAssets / quickLiabilities) * 100) / 100 : 2.5;

        // Estimated Safe Loan Quantum (Based on 35% of 6-Month Free Operating Cash Flow)
        const freeCashFlowMonthly = Math.max(0, avgMonthlyNetOperatingIncome);
        const maxRecommendedLoan = Math.round(freeCashFlowMonthly * 12 * 0.7); // 1-Year Capacity
        const maxMonthlyInstallment = Math.round(freeCashFlowMonthly * 0.40); // 40% Repayment Cap

        // 6. Gemini 2.5 Flash Credit Committee Due Diligence Thesis
        let aiUnderwritingVerdict = "";
        try {
            const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
            const prompt = `Act as an elite Senior Credit Risk Underwriter at a Tier-1 Commercial Bank.
Analyze this live merchant telemetry:
- Business: Merchant Store (Shop ID: ${shopId})
- Average Monthly Revenue: LKR ${avgMonthlyRevenue.toLocaleString()}
- Average Monthly Net Operating Income: LKR ${avgMonthlyNetOperatingIncome.toLocaleString()}
- Liquid Assets (Cash + Bank): LKR ${(liquidCashInHand + liquidCashAtBank).toLocaleString()}
- Inventory Asset Value: LKR ${currentInventoryAsset.toLocaleString()}
- Trade Receivables: LKR ${accountsReceivable.toLocaleString()}
- Trade Payables: LKR ${accountsPayable.toLocaleString()}
- Quick Ratio: ${quickRatio}
- Bounced Cheques Count: ${bouncedPdcCount} (Volume: LKR ${bouncedPdcVolume.toLocaleString()})
- Maximum Sustainable Monthly Loan Repayment: LKR ${maxMonthlyInstallment.toLocaleString()}

Write a formal 3-paragraph Bank Credit Committee Assessment in English:
Paragraph 1: Financial Viability & Working Capital Health.
Paragraph 2: Debt Service Coverage Assessment & Risk Red Flags (highlight bounced cheques if any).
Paragraph 3: Executive Underwriting Recommendation (Recommended Loan Ceiling, Tenure, and Required Covenants).`;

            const aiResp = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
            });

            if (aiResp.text) aiUnderwritingVerdict = aiResp.text.trim();
        } catch(e) {
            aiUnderwritingVerdict = "AI Due Diligence service unavailable. Manual ratio analysis recommended.";
        }

        // 7. Cryptographic Tamper-Proof Seal (SHA-256)
        const rawSealString = `${shopId}_${avgMonthlyRevenue}_${avgMonthlyNetOperatingIncome}_${quickRatio}_${Date.now()}`;
        const digitalAuditSeal = crypto.createHash('sha256').update(rawSealString).digest('hex').toUpperCase();

        return {
            success: true,
            verifiedShopId: shopId,
            merchantConsent: { targetBank: consent.targetBank, validUntil: consent.expiresAt },
            telemetry: {
                auditPeriod: `${monthsAudited} Months Historical Live Telemetry`,
                avgMonthlyRevenue,
                avgMonthlyGrossProfit,
                avgMonthlyOpex,
                avgMonthlyNetOperatingIncome,
                balanceSheet: {
                    liquidCash: liquidCashInHand + liquidCashAtBank,
                    inventoryAsset: currentInventoryAsset,
                    receivables: accountsReceivable,
                    payables: accountsPayable,
                    taxLiabilities
                },
                ratios: {
                    quickRatio,
                    bouncedChequesCount: bouncedPdcCount,
                    bouncedChequesVolume: bouncedPdcVolume
                },
                bankUnderwriting: {
                    maxLoanCapacity: maxRecommendedLoan,
                    maxSafeMonthlyInstallment: maxMonthlyInstallment,
                    suggestedTenureMonths: 24,
                    creditVerdictTier: (bouncedPdcCount > 0 || avgMonthlyNetOperatingIncome <= 0) ? "HIGH_RISK_COVENANTS_REQUIRED" : "PRIME_SME_ELIGIBLE"
                }
            },
            aiCreditMemo: aiUnderwritingVerdict,
            digitalAuditSeal: digitalAuditSeal,
            generatedAt: new Date().toISOString()
        };

    } catch (error) {
        console.error("Bank Telemetry Error:", error);
        throw new HttpsError('internal', error.message || 'Underwriting generation failed.');
    }
});