import io

import qrcode
from PIL import Image, ImageDraw, ImageFont

# Printed QR posters are colour-coded so nobody scans the wrong one:
# lecturers = green, students = blue. Both colours are dark enough for
# phone cameras to read reliably on a white background.
QR_STYLES = {
    "lecturer": {"color": "#166534", "title": "LECTURER CHECK-IN", "subtitle": "Lecturers only - students use the blue code"},
    "student": {"color": "#1e40af", "title": "STUDENT CHECK-IN", "subtitle": "Students only - lecturers use the green code"},
}


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def generate_qr_png(data: str, kind: str | None = None) -> bytes:
    style = QR_STYLES.get(kind)
    if style is None:
        img = qrcode.make(data, box_size=10, border=2)
    else:
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
        qr.add_data(data)
        qr.make(fit=True)
        code = qr.make_image(fill_color=style["color"], back_color="white").convert("RGB")

        title_font, sub_font = _font(36), _font(18)
        measure = ImageDraw.Draw(code)
        text_w = max(measure.textlength(style["title"], font=title_font), measure.textlength(style["subtitle"], font=sub_font))

        pad, band, foot = 24, 90, 60
        w = int(max(code.width, text_w + 16) + pad * 2)
        h = band + code.height + foot + pad
        img = Image.new("RGB", (w, h), style["color"])
        # White panel inside a thick coloured frame.
        ImageDraw.Draw(img).rectangle([pad // 2, band, w - pad // 2 - 1, h - pad // 2 - 1], fill="white")
        img.paste(code, ((w - code.width) // 2, band))

        draw = ImageDraw.Draw(img)
        draw.text((w / 2, band / 2), style["title"], fill="white", font=title_font, anchor="mm")
        draw.text((w / 2, band + code.height + foot / 2 - 4), style["subtitle"], fill=style["color"], font=sub_font, anchor="mm")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()
