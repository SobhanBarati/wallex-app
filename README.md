# Wallex Agentic AI Trading Engine — StarCoach Hackathon

موتور معاملاتی خودکار برای صرافی والکس که با ترکیب تحلیل تکنیکال (RSI/MACD)
و مدل زبانی (Agentic AI) تصمیم می‌گیرد و با مدیریت ریسک چندلایه معامله می‌کند.

## معماری
index.js ← حلقه اصلی، هماهنگی نمادها
├── config.js ← پیکربندی از .env
├── wallexApi.js ← REST (balance, depth, klines, orders)
├── services/
│ ├── wallexWs.js ← WebSocket قیمت لحظه‌ای
│ └── aiBoxApi.js ← فراخوانی LLM با پرامپت ساختاریافته
├── strategy/
│ ├── riskManager.js ← حجم امن، STOP/TAKE
│ ├── positionManager.js ← state محلی، reconciliation
│ └── lockManager.js ← قفل نماد (SUBMITTING/PENDING با TTL)
└── utils/
├── fileSafe.js ← read/write اتمیک
└── logger.js ← trades_log.txt + trades_log.jsonl

text

## نصب

```bash
npm install
cp .env.example .env
# مقادیر WALLEX_API_KEY و BOXAPI_KEY را پر کن


حالت	دستور	توضیح
Dry-run	IS_LIVE_TRADING=false npm start	فقط لاگ، بدون سفارش
Shadow	SHADOW_MODE=true npm start	سفارش شبیه‌سازی، بدون تماس با صرافی
Live	IS_LIVE_TRADING=true npm start	معامله واقعی
Backtest	npm run backtest -- BTCTMN 7	شبیه‌سازی روی دیتای تاریخی
Smoke test	npm test	بررسی صحت ماژول‌ها
منطق تصمیم‌گیری
اندیکاتورها روی کندل ۱۵ دقیقه: RSI(14) و MACD(12,26,9).

قوانین قطعی (در کد، نه AI):

Stop-Loss: اگر قیمت ≤ میانگین خرید × (1−0.02) → SELL

Take-Profit: اگر قیمت ≥ میانگین خرید × (1+0.025) → SELL

Force-Close: در ۱۰ دقیقه آخر چالش → SELL همه پوزیشن‌ها

AI فقط در ناحیه خاکستری فراخوانی می‌شود و خروجی آن با ویتوی محلی
(RSI<50 && MACD>0) اعتبارسنجی می‌شود. AI هرگز تنها تصمیم‌گیر نیست.

مدیریت ریسک
سقف هر معامله: MAX_TRADE_TOMAN (پیش‌فرض ۲.۵ میلیون تومان).

حداقل معامله: MIN_TRADE_TOMAN (پیش‌فرض ۱۰۰ هزار تومان).

Stop/TP درصدی روی میانگین خرید.

Lock Manager با TTL از قفل ابدی جلوگیری می‌کند.

Reconciliation خودکار: اختلاف بین state محلی و موجودی صرافی اصلاح می‌شود.

لاگ تصمیم
هر تصمیم در دو فایل ذخیره می‌شود:

trades_log.txt — خوانا برای انسان

trades_log.jsonl — یک JSON در هر خط، قابل پارس ماشینی

نمونه JSON:

json
{"ts":"2026-10-23T10:00:00Z","symbol":"BTCTMN","action":"BUY","price":22116456232,"reason":"RSI<50 && MACD>0","rsi":"45.2","macd":"1.3","hasPosition":false}
تکرارپذیری
تمام پارامترها در .env قابل تغییرند.

AI با temperature=0.1 پایدار است.

خروجی backtest در backtest.js قابل بازتولید است.

داور می‌تواند با IS_LIVE_TRADING=false کل چرخه را بدون ریسک اجرا کند.

هشدار
این نرم‌افزار صرفاً برای چالش هکاتون طراحی شده است. استفاده در بازار واقعی
بدون بازبینی کامل توصیه نمی‌شود.

text

---

## فایل ۱۷: `.gitignore` (جدید — جلوگیری از لو رفتن کلیدها)
node_modules/
.env
*.log
trades_log.jsonl
positions_state.json
orders_lock.json
*.tmp

text

---

## چک‌لیست بعد از جایگزینی

بعد از اینکه فایل‌ها رو گذاشتی، این‌ها رو اجرا کن:

```bash
# ۱. نصب
npm install

# ۲. کپی env
cp .env.example .env
# مقادیر کلیدها رو پر کن

# ۳. Smoke test
npm test
# باید همه ✅ باشند

# ۴. Dry-run
IS_LIVE_TRADING=false npm start
# در لاگ باید چرخه‌ها اجرا شوند، RSI/MACD محاسبه شوند و AI صدا زده شود

# ۵. Backtest
npm run backtest -- BTCTMN 7

# ۶. Shadow
SHADOW_MODE=true npm start