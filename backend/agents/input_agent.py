"""Agent ① 输入 Agent：接收图片/文本，输出清洗后的纯文本。

- 文本：直接清洗
- 图片：PaddleOCR 提取文字（惰性导入，不用 OCR 时无需安装）
"""
import re
from pathlib import Path

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}
_ocr = None


def _get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR  # 惰性导入

        _ocr = PaddleOCR(use_angle_cls=True, lang="ch")
    return _ocr


def ocr_image(image_path: str) -> list[str]:
    result = _get_ocr().ocr(image_path, cls=True)
    return [
        line[1][0].strip()
        for page in (result or [])
        for line in (page or [])
        if line[1][0].strip()
    ]


def clean_text(text: str) -> str:
    """去除多余空白、零宽字符，保留换行结构。"""
    text = text.replace("​", "").replace("﻿", "").replace("　", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def run(source: str) -> dict:
    """source 可以是图片路径或直接粘贴的文本。"""
    p = Path(source)
    is_image = len(source) < 260 and p.suffix.lower() in IMAGE_EXTS and p.exists()
    if is_image:
        text = clean_text("\n".join(ocr_image(str(p))))
        kind = "image"
    else:
        text = clean_text(source)
        kind = "text"
    return {"input_type": kind, "text": text}
