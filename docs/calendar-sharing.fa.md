# اشتراک تقویم بین دو نفر در RESA

RESA می‌تواند تقویم‌های Google و Microsoft را هم بخواند و هم روی آن‌ها بنویسد.
اشتراک واقعی یعنی یک **تقویم مشترک** که هر دو نفر به آن دسترسی دارند؛ نه ادغام
تقویم‌های شخصی.

## مدل کار

- هر نفر حساب خودش را در RESA وصل می‌کند.
- نفر A یک تقویم در Google Calendar می‌سازد و آن را با ایمیل نفر B به اشتراک
  می‌گذارد (دسترسی «Make changes to events»).
- نفر B در RESA همان تقویم را به‌عنوان اشتراک انتخاب می‌کند.
- از این پس هر رویدادی که هر کدام در آن تقویم بسازند یا ویرایش کنند، در تقویم
  هر دو دیده می‌شود.

رویدادهای تقویم‌های محلی RESA (که به حساب آنلاین وصل نیستند) سینک نمی‌شوند؛
فقط تقویم‌های متصل.

## گام ۱: ساخت کلید Google (یک‌بار)

1. به `https://console.cloud.google.com` برو و یک پروژه بساز.
2. `APIs & Services` → `Library` → **Google Calendar API** را فعال کن.
3. `APIs & Services` → `OAuth consent screen` → نوع **External**، نام برنامه و
   ایمیل پشتیبانی را پر کن و محدوده `.../auth/calendar` را اضافه کن.
4. `APIs & Services` → `Credentials` → `Create credentials` → **OAuth client ID**
   → نوع **Desktop app**.
5. `Client ID` و `Client secret` را بردار. برای این نوع کلاینت ثبت Redirect URI
   لازم نیست؛ RESA روی `http://127.0.0.1:<port>` گوش می‌دهد.

## گام ۲: ساخت کلید Microsoft (اختیاری)

1. به `https://entra.microsoft.com` → `App registrations` → `New registration`.
2. نوع حساب: «Accounts in any organizational directory and personal Microsoft
   accounts».
3. `Authentication` → `Add a platform` → **Mobile and desktop applications** →
   Redirect URI: `http://localhost`.
4. `API permissions` → `Microsoft Graph` → `Delegated` →
   `Calendars.ReadWrite` → `Grant admin consent`.
5. مقدار `Application (client) ID` را بردار (برای این مسیر Client secret لازم نیست).

## گام ۳: قرار دادن کلیدها و ساخت برنامه

فایل `src-tauri/oauth-credentials.json` را بساز (در `.gitignore` است و کامیت
نمی‌شود؛ نمونه در `src-tauri/oauth-credentials.example.json`):

```json
{
  "google": {
    "clientId": "xxxx.apps.googleusercontent.com",
    "clientSecret": "xxxx"
  },
  "microsoft": {
    "clientId": "xxxx"
  }
}
```

سپس برنامه را دوباره بساز. این مقادیر در زمان کامپایل داخل باینری قرار می‌گیرند
(`src-tauri/build.rs`)، پس تغییر فایل بدون build دوباره اثری ندارد.

## گام ۴: اشتراک تقویم

1. در Google Calendar → تنظیمات تقویم → `Share with specific people` →
   ایمیل نفر دوم را با دسترسی «Make changes to events» اضافه کن.
2. در RESA: تنظیمات تقویم → تب «اشتراک‌های تقویم» → منبع را روی Google بگذار →
   «اتصال حساب» → حساب را انتخاب کن → تقویم مشترک را تیک بزن.
3. همین کار را از سمت نفر دوم هم انجام بده (می‌تواند تقویم خودش را به اشتراک
   بگذارد یا فقط تقویم مشترک را ببیند).

## اگر فقط دیدن کافی است

بدون هیچ کلیدی می‌توانی لینک `https://` یا `webcal://` تقویم (مثلاً «Secret
address in iCal format» در Google) را در همان تب «اشتراک‌های تقویم» اضافه کنی.
این مسیر فقط خواندنی است و هر ۱ تا ۳۰ دقیقه به‌روزرسانی می‌شود.

## پیام «اتصال حساب در این نسخه فعال نیست»

یعنی باینری فعلی بدون `oauth-credentials.json` ساخته شده است. گام ۳ را انجام بده
و برنامه را دوباره build کن.
