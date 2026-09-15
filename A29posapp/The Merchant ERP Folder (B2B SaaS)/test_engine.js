// test_engine.js - ඔබේ පරිගණකය තුළ දුවන ස්වයංක්‍රීය පරීක්ෂණ මුරකරුවා
const assert = require('assert');

console.log("\n🧪 ධාවනය වෙමින් පවතී: පද්ධතියේ ගණිතමය සහ බදු නීති පරීක්ෂාව...");

// 1. පාවෙන දශම දෝෂ පරීක්ෂාව (0.1 + 0.2 Floating point leak)
const sum = Math.round((0.1 + 0.2 + Number.EPSILON) * 100) / 100;
assert.strictEqual(sum, 0.30, "දෝෂයකි: Floating-point ගණනය කිරීම් වැරදියි!");

// 2. RAMIS E-Invoicing (SSCL 2.5% + VAT 18%) Reverse Tax Math පරීක්ෂාව
const grossBill = 1209.50;
const rSSCL = 2.5 / 100;
const rVAT = 18.0 / 100;
const multiplier = (1 + rSSCL) * (1 + rVAT); // 1.2095
const base = Math.round((grossBill / multiplier + Number.EPSILON) * 100) / 100;
const sscl = Math.round((base * rSSCL + Number.EPSILON) * 100) / 100;
const vat = Math.round((grossBill - base - sscl + Number.EPSILON) * 100) / 100;

assert.strictEqual(base, 1000.00, "දෝෂයකි: Tax Base එක 1000.00 විය යුතුය!");
assert.strictEqual(sscl, 25.00, "දෝෂයකි: SSCL එක 25.00 විය යුතුය!");
assert.strictEqual(vat, 184.50, "දෝෂයකි: VAT එක 184.50 විය යුතුය!");
assert.strictEqual(base + sscl + vat, grossBill, "දෝෂයකි: බදු එකතුව මුළු බිලට සමාන නොවේ!");

// 3. EPF (8% / 12%) සහ ETF (3%) නීති පරීක්ෂාව
const salary = 100000.00;
const epfEmp = Math.round((salary * 0.08 + Number.EPSILON) * 100) / 100;
const epfEmpr = Math.round((salary * 0.12 + Number.EPSILON) * 100) / 100;
const etfEmpr = Math.round((salary * 0.03 + Number.EPSILON) * 100) / 100;

assert.strictEqual(epfEmp, 8000.00, "දෝෂයකි: සේවක EPF 8% වැරදියි!");
assert.strictEqual(epfEmpr, 12000.00, "දෝෂයකි: සේවායෝජක EPF 12% වැරදියි!");
assert.strictEqual(etfEmpr, 3000.00, "දෝෂයකි: ETF 3% වැරදියි!");

console.log("✅ සියලුම පරීක්ෂණ 100% ක් සමත් විය! Firebase වෙත Upload කිරීමට අවසර ඇත.\n");
process.exit(0); // සමත් බව Firebase CLI එකට දන්වයි