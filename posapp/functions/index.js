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