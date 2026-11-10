"""
Génère src/data/exercises.json à partir de l'API publique wger.de
(https://wger.de/api/v2/exerciseinfo/, données sous licence CC BY-SA).

Le catalogue est embarqué dans l'app : recherche instantanée, hors ligne,
aucune requête réseau pendant l'utilisation.

Usage :  python scripts/build-exercise-catalog.py [exerciseinfo.json]
(sans argument, le fichier est téléchargé depuis wger.de)
"""
import json
import os
import sys
import urllib.request

FR, EN = 12, 2
CATEGORIES = {
    "Chest": "Pectoraux", "Back": "Dos", "Shoulders": "Épaules", "Arms": "Bras",
    "Legs": "Jambes", "Calves": "Jambes", "Abs": "Abdos", "Cardio": "Cardio",
}
MUSCLES = {
    1: "Biceps", 2: "Épaules", 3: "Dentelé", 4: "Pectoraux", 5: "Triceps",
    6: "Abdos", 7: "Mollets", 8: "Fessiers", 9: "Trapèzes", 10: "Quadriceps",
    11: "Ischios", 12: "Dorsaux", 13: "Brachial", 14: "Obliques", 15: "Mollets",
}
EQUIPMENT = {
    1: "Barre", 2: "Barre EZ", 3: "Haltères", 4: "Tapis", 5: "Swiss ball",
    6: "Barre de traction", 7: "Poids du corps", 8: "Banc", 9: "Banc incliné",
    10: "Kettlebell", 11: "Élastique", 12: "Poulie",
}


def load(argv):
    if len(argv) > 1:
        with open(argv[1], encoding="utf-8") as f:
            return json.load(f)["results"]
    req = urllib.request.Request(
        "https://wger.de/api/v2/exerciseinfo/?limit=2000&format=json",
        headers={"User-Agent": "QoGym catalog builder"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["results"]


def main():
    out, seen = [], set()
    for e in load(sys.argv):
        tr = {t["language"]: t["name"].strip() for t in e.get("translations", [])}
        name = tr.get(FR)
        if not name:
            continue  # app francophone : uniquement les exercices traduits
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        name = name[0].upper() + name[1:]
        item = {
            "n": name,
            "c": CATEGORIES.get(e["category"]["name"], "Autre"),
            "m": sorted({MUSCLES[m["id"]] for m in e["muscles"] if m["id"] in MUSCLES}),
            "e": sorted({EQUIPMENT[q["id"]] for q in e["equipment"] if q["id"] in EQUIPMENT}),
        }
        en = tr.get(EN)
        if en and en.lower() != key:
            item["en"] = en
        imgs = sorted(e.get("images", []), key=lambda i: not i.get("is_main"))
        if imgs:
            thumb = (imgs[0].get("thumbnails") or {}).get("small") or imgs[0]["image"]
            item["i"] = thumb.replace("https://wger.de/media/exercise-images/", "")
        out.append(item)
    out.sort(key=lambda x: x["n"].lower())
    dest = os.path.join(os.path.dirname(__file__), "..", "src", "data", "exercises.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)} exercices -> {os.path.normpath(dest)}")


if __name__ == "__main__":
    main()
