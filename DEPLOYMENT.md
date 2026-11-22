# Triển khai Production & Yêu cầu PWA (HTTPS)

Tài liệu này mô tả cấu hình triển khai chuẩn cho **Russian Dictation (RussianDict)** dưới dạng Progressive Web App (PWA) trên môi trường production.

## 1. Yêu cầu bắt buộc về HTTPS

Service Worker, Web App Manifest nâng cao, sự kiện `beforeinstallprompt` (cài đặt trực tiếp trên Android Chrome / Desktop Chrome) và bộ nhớ ngoại tuyến an toàn đều **bắt buộc chạy qua HTTPS** trên môi trường production:

- **Production**: Máy chủ hoặc reverse proxy (Cloud Run, Nginx, Caddy, Cloudflare, Vercel, Render...) phải phục vụ ứng dụng qua `https://` với chứng chỉ TLS hợp lệ (không lỗi chứng chỉ tự ký).
- **Local Development**: Trình duyệt coi `http://localhost:3000` (và `127.0.0.1`) là *secure context* nên Service Worker và Manifest vẫn hoạt động khi kiểm thử cục bộ. Không dùng IP LAN dạng `http://192.168.x.x` để thử cài đặt PWA trên điện thoại nếu chưa bọc HTTPS tunnel.
- **Same-origin Service Worker**: Tệp `/sw.js` và `/manifest.webmanifest` phải được phục vụ từ cùng origin gốc (`/`) với `Content-Type` chuẩn (`application/javascript` cho `sw.js`, `application/manifest+json` cho `manifest.webmanifest`) và **không redirect chéo domain**.

## 2. Quy trình Build & Khởi chạy Production

```bash
# 1. Cài đặt phụ thuộc
npm install

# 2. Kiểm tra kiểu TypeScript & biên dịch bundle PWA + Service Worker (Workbox)
npm run lint
npm run build

# 3. Khởi chạy máy chủ Express phục vụ API + tệp tĩnh từ dist/
NODE_ENV=production npm start
```

Sau khi chạy `npm run build`, VitePWA (`vite-plugin-pwa`) tự động tạo trong `dist/`:
- `dist/manifest.webmanifest` (`name: "Russian Dictation"`, `short_name: "RussianDict"`, `display: "standalone"`)
- `dist/sw.js` và `dist/workbox-*.js` (precache app shell tĩnh & quản lý phiên bản cache)
- Các icon chuẩn (`pwa-192x192.png`, `pwa-512x512.png`, `pwa-maskable-512x512.png`, `apple-touch-icon.png`, `icon.svg`)

## 3. Biến môi trường máy chủ

Tham khảo `.env.example`:
- `GEMINI_API_KEY`: Bắt buộc để bật tạo bài học AI và tổng hợp giọng đọc tiếng Nga Gemini 3.8 Flash TTS (`/api/lessons/generate`, `/api/analysis/explain`, `/api/tts/*`). Luôn giữ ở phía server, tuyệt đối không đưa vào mã client (`VITE_*`).
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (tùy chọn): Dùng khi mở rộng đồng bộ đám mây; mặc định ứng dụng lưu tiến độ học cục bộ trên thiết bị.

## 4. Hành vi Cache & Bảo mật ngoại tuyến

- **Service Worker (Workbox)**: Chỉ precache app shell (HTML, JS, CSS, SVG/PNG icons) và font chữ. Mọi route `/api/*` được loại trừ khỏi cache (`navigateFallbackDenylist: [/^\/api\//]`, không có runtime caching cho API) để không lưu nhầm dữ liệu người học riêng tư hay phản hồi AI động.
- **Tải ngoại tuyến theo yêu cầu (IndexedDB)**: Người dùng chủ động nhấn **Tải ngoại tuyến** trong Thư viện hoặc Phòng nghe chép để lưu bản sao bài học và các tệp audio WAV vào `IndexedDB` (`rd_offline_store_v1`), tránh tự động tải tệp âm thanh lớn khi không cần thiết.

## 5. Cài đặt trên thiết bị di động

- **Android (Chrome / Edge / Samsung Internet)**: Khi truy cập qua HTTPS, biểu ngữ **Cài app / Cài đặt ứng dụng** sẽ kích hoạt hộp thoại cài đặt gốc thông qua `beforeinstallprompt`.
- **iPhone / iPad (iOS Safari)**: Apple WebKit không hỗ trợ `beforeinstallprompt`; người dùng nhấn **Cài app** để mở hướng dẫn từng bước (*Chia sẻ → Thêm vào Màn hình chính*), sử dụng `<meta name="apple-mobile-web-app-capable" content="yes">` và icon PNG 180×180 (`apple-touch-icon.png`).
