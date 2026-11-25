# ساخت و انتشار RESA (ویندوز و اندروید)

هر چیزی که برای بالا آوردن، بیلد گرفتن و انتشار نسخه لازم است، در همین یک
سند جمع شده: پیش‌نیازها، دستورها، مسیر خروجی‌ها، کلید امضای اندروید،
ورک‌فلوهای گیت‌هاب و خطاهای رایج.

## ۱) پیش‌نیازها

**ویندوز (دسکتاپ)**

- Node.js 20 یا بالاتر (CI از ۲۰ استفاده می‌کند)
- Rust stable + ابزارهای C++ مایکروسافت (Build Tools) و WebView2
- Tauri CLI از devDependencies نصب می‌شود (`@tauri-apps/cli` 2.11.5)

**اندروید (اختیاری، برای APK)**

- Android SDK (build-tools 36، platform 36)
- NDK `27.0.12077973`
- JDK 21
- روی این دستگاه: `D:\Android\Sdk` و `D:\Android\jdk21`؛ اسکریپت ساخت این
  مسیرها را پیش‌فرض دارد و در CI از `ANDROID_SDK_ROOT` / `ANDROID_NDK_HOME` /
  `JAVA_HOME` می‌خواند.

## ۲) اجرا و توسعه

```powershell
cd "D:\RESA desktop\nowly-src"
npm ci
npm run tauri dev        # برنامهٔ واقعی با هستهٔ Rust
npm run dev              # فقط رابط در مرورگر (بدون دستورهای Tauri)
```

قبل از هر کامیت:

```powershell
npx tsc --noEmit
npm test
npm run version:check
```

## ۳) بیلد ویندوز

```powershell
npm run tauri build
```

خروجی‌ها:

- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/msi/*.msi`

برنامهٔ نصب‌شده در `%LOCALAPPDATA%\RESA` قرار می‌گیرد و دادهٔ کاربر جدا از آن،
در `%APPDATA%\com.resa.app` است؛ نصب مجدد داده را پاک نمی‌کند.

## ۴) بیلد اندروید

```powershell
powershell -ExecutionPolicy Bypass -File scripts\android-build.ps1 -Abi arm64 -Release
```

- `-Abi`: `arm64` (گوشی واقعی، پیش‌فرض)، `x86_64` (شبیه‌ساز)، `armv7`، `x86`.
- `-Release`: نسخهٔ امضاشده؛ بدون آن APK دیباگ ساخته می‌شود.
- شبیه‌ساز: `emulator -avd resa` و نصب با
  `adb install -r src-tauri\gen\android\app\build\outputs\apk\x86_64\debug\app-x86_64-debug.apk`.

خروجی نسخهٔ ریلیز:

```text
src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release.apk
```

### اسکریپت چه می‌کند

`scripts/android-build.ps1` به‌جای `tauri android build` مستقیم Gradle را
صدا می‌زند (چون Tauri CLI روی ویندوز برای ساخت symlink به Developer Mode
نیاز دارد). دو مرحلهٔ مهم قبل از Gradle:

1. `npm run build` — بستهٔ رابط کاربری داخل باینری Rust جاسازی می‌شود.
2. `node scripts/android-gen-gradle.mjs` — فایل‌های تولیدی را می‌سازد:
   - `app/tauri.settings.gradle` و `app/tauri.build.gradle.kts` (وابستگی پلاگین‌ها)
   - `app/tauri.properties` (نسخه و versionCode از `package.json`)
   - `app/src/main/java/com/resa/app/generated/*.kt` (`TauriActivity`،
     `WryActivity`، `Ipc`، …) و `proguard`ها

پوشهٔ `generated/` و `tauri.properties` در git نیستند؛ اگر روی ماشین تازه
بیلد می‌گیرید، همین اسکریپت آن‌ها را می‌سازد. **دستی ویرایش نکنید.**

### امضای APK

- کلید: `D:\RESA desktop\android-signing\resa-release.jks` (alias: `resa`)
- رمزها: `D:\RESA desktop\android-signing\keystore.properties`
- برای امضا، همان فایل را در `src-tauri\gen\android\app\keystore.properties`
  کپی کنید؛ `app/build.gradle.kts` اگر این فایل باشد نسخهٔ release را امضا
  می‌کند (وگرنه APK بدون امضا/unsigned می‌ماند).

**این کلید را گم نکنید.** آپدیت روی گوشی فقط با همان کلید نصب می‌شود؛ کلید
تازه یعنی «برنامهٔ دیگر» و کاربر باید اول حذف کند.

بررسی سریع خروجی:

```powershell
& "D:\Android\Sdk\build-tools\36.0.0\aapt2.exe" dump badging <apk> | Select-String "package:"
& "D:\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs <apk>
```

## ۵) نسخه‌گذاری

نسخه در پنج فایل تکرار شده و همه باید یکی باشند:

`package.json`، `package-lock.json`، `src-tauri/Cargo.toml`،
`src-tauri/Cargo.lock`، `src-tauri/tauri.conf.json`.

- `scripts/version-sync.mjs` تنها جایی است که این پنج فایل را می‌نویسد.
- `npm run version:check` ناهم‌خوانی را قرمز می‌کند (در CI هم اجرا می‌شود).
- هنگام انتشار، `.github/scripts/prepare-version.mjs` بالاترین تگ `vX.Y.Z` و
  نسخهٔ `package.json` را مقایسه می‌کند و اگر آن نسخه قبلاً تگ شده باشد یک
  patch بالا می‌برد. نتیجه فقط داخل runner نوشته می‌شود؛ چیزی به شاخه برنمی‌گردد.
- برای پرش به نسخهٔ مینور/ماژور جدید، `package.json` را دستی بالا ببرید.
- نسخه هرگز نباید عقب برود (مثلاً از 0.2.31 به 0.2.0).

## ۶) CI و انتشار

**`ci.yml`** — روی push به `main`/`mobile` و روی PR: `npm ci` →
`version:check` → `tsc --noEmit` → `npm test`. نام job: `test`.

**`release.yml`** — روی push به `main` یا اجرای دستی از تب Actions:

1. نسخه را تعیین و در manifestها می‌نویسد، notes انگلیسی از کامیت‌ها می‌سازد.
2. ویندوز: `npm run tauri build` + `SHA256SUMS.txt`.
3. اندروید: نصب JDK/NDK، نوشتن keystore از Secrets، بیلد arm64، بررسی امضا،
   کپی به `artifacts/RESA-<version>-arm64.apk` و افزودن هش به `SHA256SUMS.txt`.
4. انتشار Release با تگ `v<version>` و فایل‌های exe/msi/apk/SHA256SUMS.

Secrets لازم (یک‌بار تنظیم شده‌اند):

| نام | مقدار |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 فایل `resa-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | رمز keystore |
| `ANDROID_KEY_ALIAS` | `resa` |
| `ANDROID_KEY_PASSWORD` | رمز کلید |

`LLM_API_KEY` اختیاری است؛ اگر نباشد notes همان فهرست کامیت‌ها می‌شود.

**محافظت شاخه‌ها:** `main` بدون force-push و بدون حذف، با status check اجباری
`test`؛ `mobile` فقط بدون حذف.

## ۷) خطاهای رایج

| خطا | راه‌حل |
| --- | --- |
| `Unresolved reference: TauriActivity` | `node scripts/android-gen-gradle.mjs` را اجرا کنید (فایل‌های `generated/` ساخته شوند) |
| APK با نسخهٔ قدیمی (`0.2.0`) | `app/tauri.properties` کهنه است؛ همان اسکریپت بازنویسی‌اش می‌کند |
| `Failed to install ... INSTALL_FAILED_UPDATE_INCOMPATIBLE` | APK با کلید دیگری امضا شده؛ نسخهٔ قبلی را حذف کنید |
| Gradle به `dl.google.com` وصل نمی‌شود | روی این شبکه میرور Aliyun لازم است (پیش‌فرض روشن)؛ در CI با `RESA_GRADLE_MIRROR=0` خاموش می‌شود |
| `version:check` قرمز | یکی از پنج manifest دستی عوض شده؛ `node scripts/version-sync.mjs` یا مقدار درست را برگردانید |
| Release ساخته نشد | job اندروید fail شده؛ لاگ `Build Android APK` را ببینید و بعد دوباره push/rerun کنید |
