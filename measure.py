import cv2
import numpy as np

# every unit expressed in centimetres
UNIT_TO_CM = {"mm": 0.1, "cm": 1.0, "m": 100.0, "in": 2.54, "ft": 30.48}


def _width_height(box):
    """Return (width_px, height_px) of a rotated rectangle.
    The side that is more horizontal is the width, the other is the height."""
    p = box.astype(float)
    s1, s2 = p[1] - p[0], p[2] - p[1]
    l1, l2 = float(np.hypot(*s1)), float(np.hypot(*s2))
    if abs(s1[0]) >= abs(s1[1]):
        return l1, l2
    return l2, l1


def detect_objects(img, min_area=1500):
    """Find object boundaries and return them sorted left -> right."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (7, 7), 0)
    edges = cv2.Canny(gray, 50, 100)
    edges = cv2.dilate(edges, None, iterations=2)
    edges = cv2.erode(edges, None, iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    objects = []
    for c in contours:
        if cv2.contourArea(c) < min_area:
            continue
        rect = cv2.minAreaRect(c)
        box = cv2.boxPoints(rect)
        w, h = _width_height(box)
        objects.append({
            "cx": float(rect[0][0]),
            "box": [[int(x), int(y)] for x, y in box],
            "width_px": w,
            "height_px": h,
        })
    objects.sort(key=lambda o: o["cx"])
    return objects
