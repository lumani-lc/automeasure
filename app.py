import base64
import csv
import io
import os
import time

import cv2
import mysql.connector
import numpy as np
from flask import Flask, Response, jsonify, render_template, request

from measure import UNIT_TO_CM, detect_objects

app = Flask(__name__)
CAPTURE_DIR = os.path.join(app.static_folder, "captures")
os.makedirs(CAPTURE_DIR, exist_ok=True)

# XAMPP defaults: user root, empty password
DB_CONFIG = dict(host="localhost", user="root", password="root", database="automeasure")


def get_db():
    return mysql.connector.connect(**DB_CONFIG)


def decode_image(data_url):
    raw = base64.b64decode(data_url.split(",", 1)[1])
    arr = np.frombuffer(raw, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/calibrate")
def api_calibrate():
    d = request.get_json()
    try:
        ref_cm = float(d["ref_size"]) * UNIT_TO_CM[d["unit"]]
        if ref_cm <= 0:
            raise ValueError
    except (KeyError, ValueError, TypeError):
        return jsonify(error="Invalid reference size or unit."), 400

    objs = detect_objects(decode_image(d["image"]))
    if not objs:
        return jsonify(error="No reference object found. Use a plain background and good light."), 400

    ref = objs[0]  # the left-most object is the reference
    ref_px = max(ref["width_px"], ref["height_px"])  # its longest side
    return jsonify(px_per_cm=ref_px / ref_cm, reference_box=ref["box"])

@app.post("/api/measure")
def api_measure():
    d = request.get_json()
    ppc = d.get("px_per_cm")
    img = decode_image(d["image"])

    if d.get("mode") == "yolo":
        try:
            from yolo_detect import detect_objects_yolo
        except ImportError:
            return jsonify(error="YOLO is not installed. Run: pip install ultralytics"), 400
        objs = detect_objects_yolo(img)
    else:
        objs = detect_objects(img)

    out = []
    for i, o in enumerate(objs, 1):
        item = {"id": i, "box": o["box"], "name": o.get("name", ""),
                "width_px": round(o["width_px"], 1),
                "height_px": round(o["height_px"], 1)}
        if ppc:
            item["width_cm"] = round(o["width_px"] / ppc, 3)
            item["height_cm"] = round(o["height_px"] / ppc, 3)
        out.append(item)
    return jsonify(objects=out)

@app.post("/api/save")
def api_save():
    d = request.get_json()
    objects = d.get("objects", [])
    if not objects:
        return jsonify(error="Nothing to save."), 400

    image_path = None
    if d.get("image"):
        filename = f"{int(time.time() * 1000)}.jpg"
        with open(os.path.join(CAPTURE_DIR, filename), "wb") as f:
            f.write(base64.b64decode(d["image"].split(",", 1)[1]))
        image_path = f"captures/{filename}"

    source = d.get("source") if d.get("source") in ("camera", "upload") else "camera"
    conn = get_db()
    cur = conn.cursor()
    for o in objects:
        cur.execute(
            "INSERT INTO measurements (label, width_cm, height_cm, source, image_path) "
            "VALUES (%s, %s, %s, %s, %s)",
                        (" - ".join(x for x in (d.get("label", ""), o.get("name", "")) if x)[:100],
             o["width_cm"], o["height_cm"], source, image_path),
        )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify(saved=len(objects))


def fetch_history(limit=200):
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM measurements ORDER BY id DESC LIMIT %s", (limit,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    for r in rows:
        r["created_at"] = r["created_at"].strftime("%Y-%m-%d %H:%M:%S")
    return rows


@app.get("/api/history")
def api_history():
    return jsonify(fetch_history())


@app.delete("/api/history/<int:row_id>")
def api_delete(row_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM measurements WHERE id = %s", (row_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify(ok=True)


@app.get("/api/export")
def api_export():
    unit = request.args.get("unit", "cm")
    factor = UNIT_TO_CM.get(unit, 1.0)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "label", f"width_{unit}", f"height_{unit}", "source", "created_at"])
    for r in fetch_history(100000):
        w.writerow([r["id"], r["label"], round(r["width_cm"] / factor, 3),
                    round(r["height_cm"] / factor, 3), r["source"], r["created_at"]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=measurements.csv"})


if __name__ == "__main__":
    app.run(debug=True, port=5001)
