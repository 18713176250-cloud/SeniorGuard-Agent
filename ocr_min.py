"""最小 OCR 验证脚本：从图片文件或剪贴板截图提取文字。

用法:
    python ocr_min.py path/to/image.png   # 识别图片文件
    python ocr_min.py --clip              # 识别剪贴板中的截图
依赖: pip install rapidocr-onnxruntime pillow
"""
import sys
import time

from PIL import Image, ImageGrab
from rapidocr_onnxruntime import RapidOCR


def load_image(arg):
    if arg == "--clip":
        img = ImageGrab.grabclipboard()
        if not isinstance(img, Image.Image):
            sys.exit("剪贴板中没有图片，请先截图 (Win+Shift+S)")
        return img
    return Image.open(arg)


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # 避免 Windows 控制台 GBK 乱码
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    img = load_image(sys.argv[1]).convert("RGB")
    import numpy as np

    engine = RapidOCR()
    t0 = time.time()
    result, _ = engine(np.array(img))
    cost = time.time() - t0
    if not result:
        print("未识别到文字")
        return
    for _box, text, score in result:
        print(f"[{float(score):.2f}] {text}")
    print("-" * 30)
    print("全文:", "\n".join(r[1] for r in result))
    print(f"耗时 {cost:.2f}s, 共 {len(result)} 行")


if __name__ == "__main__":
    main()
