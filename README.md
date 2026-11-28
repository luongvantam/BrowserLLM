# BrowserLLM — 100% Free GitHub Pages AI Chat (WebGPU & WASM)

Ứng dụng AI chạy **100% trên trình duyệt** (không cần thuê server, deploy miễn phí hoàn toàn lên **GitHub Pages**):
- **WebGPU (`q4`)**: `Qwen3.5-0.8B` (`onnx-community/Qwen3.5-0.8B-Text-ONNX`, ~550 MB) — thế hệ Qwen 3.5 mới, tải nhanh và tự cache vào trình duyệt cho các lần mở sau.
- **WASM CPU fallback (`q8`)**: tự động chuyển sang `Qwen2.5-Coder-0.5B-Instruct` trên các thiết bị không có WebGPU.

## Triển khai miễn phí lên GitHub Pages

1. Push code lên GitHub (`main`) — đã có sẵn workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
2. Vào **Settings → Pages** của repo trên GitHub, chọn **Source: GitHub Actions**.
3. GitHub Actions sẽ tự động `npm run build`, kiểm tra giới hạn `<= 20 MB`/file và xuất bản lên `https://<username>.github.io/BrowserLLM/`.

## Chạy local

```bash
npm install
npm run dev
```

## Giấy phép

Mã nguồn dự án phát hành theo giấy phép **MIT** ([LICENSE](LICENSE)).
