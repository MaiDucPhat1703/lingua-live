# Lingua Live

Website ghi âm, chép lời và dịch Anh - Việt, hỗ trợ từ điển tên riêng, sửa câu và xuất TXT/SRT/JSON.

## Chạy mô hình trên máy

1. Cài Python 3.11 64-bit từ https://www.python.org/downloads/. Trên Windows chọn Add Python to PATH khi cài.
2. Giải nén gói ứng dụng. Mở start-windows.bat. Trên macOS/Linux chạy bash start-mac-linux.sh.
3. Giữ cửa sổ xử lý mở và truy cập http://127.0.0.1:8765 bằng Chrome hoặc Edge.
4. Chọn Mô hình trên máy của bạn, bấm Chuẩn bị mô hình. Lần đầu cần mạng để tải Whisper small và hai mô hình dịch Marian từ Hugging Face. Cần dung lượng đĩa ở mức vài GB cho thư viện và mô hình. Tốc độ tải tùy kết nối.
5. Khi trạng thái sẵn sàng, chọn ngôn ngữ nói, bấm Bắt đầu ghi âm và cấp quyền micro. Kết thúc để tải âm thanh hoặc xuất bản chép lời.

Sau khi mô hình tải xong, xử lý trên máy không có quota ký tự từ dịch vụ bên ngoài. CPU, RAM, dung lượng và điện vẫn giới hạn tốc độ và thời lượng thực tế. Bản này mặc định CPU int8 cho Whisper. Nếu cần mô hình nhẹ hơn, đặt biến môi trường WHISPER_MODEL=base trước khi khởi động. Mỗi đoạn thu 8 giây, cần cộng thời gian xử lý vào độ trễ. Khi máy xử lý không kịp và có quá nhiều đoạn chờ, ứng dụng dừng ghi, thông báo và giữ âm thanh đã thu để tải xuống.

Máy chủ chỉ lắng nghe 127.0.0.1. Website và API cùng origin tại localhost. Trang GitHub Pages hoặc Sites cung cấp giao diện và gói tải, không tự chạy mô hình Python. Không đưa localhost server lên mạng công cộng bằng cách đổi host mà chưa bổ sung xác thực và TLS.

## Dữ liệu và tên riêng

Lời gốc và bản dịch lưu trên trình duyệt bằng localStorage. Bản âm thanh lưu bằng IndexedDB. Xóa dữ liệu trang sẽ xóa các bản lưu. Nên tải file xuống sau buổi ghi.

Thêm tên chuẩn và các cách nghe nhầm trong Từ điển tên riêng. Whisper nhận tên chuẩn làm gợi ý, sau đó ứng dụng chuẩn hóa cách viết. Trong dịch tại máy, các tên chuẩn được giữ nguyên còn các phần văn bản quanh tên được dịch riêng. Cách này bảo vệ cách viết tên, nhưng có thể làm câu dịch kém mượt ở vị trí ghép. Nhận dạng vẫn cần kiểm tra với giọng nói thực tế. Chọn một ngôn ngữ nói mỗi phiên, chưa tự phân biệt nhiều người nói hoặc nhận ngôn ngữ đổi liên tục.

## Bản thử dịch miễn phí

Chế độ Bản thử dịch miễn phí vẫn có SpeechRecognition của trình duyệt và MyMemory. MyMemory có quota khoảng 5.000 ký tự/ngày ở cấu hình này. Âm thanh có thể được gửi tới dịch vụ nhận dạng của trình duyệt, văn bản được gửi tới MyMemory. Chế độ mô hình trên máy dùng API localhost và không gọi MyMemory. Font giao diện vẫn tải qua Google Fonts.

## Mô hình

- https://github.com/SYSTRAN/faster-whisper
- https://huggingface.co/Helsinki-NLP/opus-mt-vi-en
- https://huggingface.co/Helsinki-NLP/opus-mt-en-vi

Ứng dụng không có giới hạn phiên do tài khoản nhưng không bảo đảm chạy vô hạn hoặc dịch chính xác tuyệt đối. Chưa đo tốc độ và chất lượng bằng thiết bị người dùng. Phụ đề SRT dùng thời điểm đoạn thu, cần chỉnh nếu xuất bản.

## Phát triển

node --check dist/app.js
python -m py_compile server/app.py
python -m uvicorn server.app:app --host 127.0.0.1 --port 8765

Khi cần cập nhật ứng dụng, giữ thư mục .venv và cache mô hình trên máy. Không đưa .venv, cache hoặc dữ liệu ghi âm vào repository.
