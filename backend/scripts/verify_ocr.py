"""verify_ocr.py — 任务1-6：验证 OCR（图片 + 剪贴板截图）

方案：PaddleOCR（本地，支持中/英/繁体，无需外部 API Key）
用法：
  python verify_ocr.py 图片路径.png        # 识别图片文件
  python verify_ocr.py --clipboard          # 识别系统剪贴板截图
依赖：pip install paddleocr paddlepaddle pillow
"""
import sys
from paddleocr import PaddleOCR

ocr = PaddleOCR(use_angle_cls=True, lang="ch")  # 中文，自动识别方向


def extract_lines(image_path):
    result = ocr.ocr(image_path, cls=True)
    lines = []
    for page in result or []:
        for line in page or []:
            text = line[1][0].strip()
            if text:
                lines.append(text)
    return lines


if __name__ == "__main__":
    if "--clipboard" in sys.argv:
        # 从系统剪贴板读截图再 OCR
        from PIL import ImageGrab, Image
        img = ImageGrab.grabclipboard()
        if not isinstance(img, Image.Image):
            print("⚠️ 剪贴板里没有图片（请先截图）")
            sys.exit(1)
        img.save("_clipboard.png")
        lines = extract_lines("_clipboard.png")
    else:
        if len(sys.argv) < 2:
            print("用法: python verify_ocr.py 图片路径.png  或  python verify_ocr.py --clipboard")
            sys.exit(1)
        lines = extract_lines(sys.argv[1])

    if not lines:
        print("⚠️ 未识别到文字")
    else:
        print("✅ OCR 成功，提取到文字：")
        for i, l in enumerate(lines, 1):
            print(f"  {i}. {l}")