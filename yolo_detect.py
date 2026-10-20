"""YOLO object detection (Ultralytics). Loaded only when YOLO mode is used."""
from ultralytics import YOLO

_model = None


def get_model():
    global _model
    if _model is None:
        _model = YOLO("yolov8n.pt")   # downloads automatically the first time
    return _model


def detect_objects_yolo(img, conf=0.35):
    """Return objects in the same format as detect_objects() in measure.py,
    plus the class name (e.g. 'bottle', 'cell phone')."""
    result = get_model().predict(img, conf=conf, verbose=False)[0]
    names = result.names
    objects = []
    for b in result.boxes:
        x1, y1, x2, y2 = b.xyxy[0].tolist()
        objects.append({
            "cx": (x1 + x2) / 2,
            "box": [[int(x1), int(y1)], [int(x2), int(y1)],
                    [int(x2), int(y2)], [int(x1), int(y2)]],
            "width_px": x2 - x1,
            "height_px": y2 - y1,
            "name": names[int(b.cls[0])],
        })
    objects.sort(key=lambda o: o["cx"])
    return objects