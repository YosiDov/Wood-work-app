# עבודות עץ של מושקי

תכנון רהיטי עץ בתלת־ממד: ארונות, מטבחים, כונניות, שולחנות ועוד — עם בדיקת חוזק לכל חלק, רשימת חיתוך ושמירה כקובץ Collada.

**לפתיחה:** הורידו את [`release/mushki-woodworks.html`](release/mushki-woodworks.html) ופתחו אותו בדפדפן (Chrome, Edge, Safari). הקובץ עובד גם בלי אינטרנט.

## מה יש בפנים

- **תבניות פרמטריות** – כוננית, ארון בגדים, מטבח תחתון ועליון, שולחן, ספסל, מגירה, ארגז. משנים רוחב/גובה/עומק/מדפים והרהיט נבנה מחדש.
- **חלקים בודדים** – קרש, לוח, קורה, מוט עגול. הזזה עם חיצים (נצמד לחלקים סמוכים), מתיחה עם ידיות צהובות, הקלדת מידה על סרט המדידה.
- **13 סוגי עץ ולוחות** – אורן, אלון, בוק, אגוז, מייפל, דובדבן, טיק, עץ אדום, דיקט ליבנה, סנדוויץ׳, MDF, מלמין, OSB.
- **בדיקת חוזק** – כל מדף מציג כמה ק״ג הוא מחזיק; צבע ירוק/צהוב/אדום ושקיעה מוגדלת ×10.
- **רשימת חיתוך** – כמויות, מידות, משקל, מספר גיליונות ועלות משוערת; ייצוא ל-CSV.
- **קבצים** – שמירה ופתיחה כ-Collada (`.dae`). הפרויקט המלא נשמר בתוך הקובץ (ב-`<extra>`), כך שהוא נפתח כאן עם כל הנתונים, ובכל תוכנת תלת־ממד אחרת (Blender, SketchUp, FreeCAD) כגאומטריה רגילה. קובץ `.dae` מתוכנה אחרת מיובא כקרשים.

## Strength model (simplified EN 1995 / Eurocode 5)

- Each structural part is a **beam** (longest side horizontal) or a **column** (longest side vertical).
- Supports come from touching faces: a beam rests on parts below it or is fixed between parts at its ends; a stiffer board bridges over a weaker parallel one instead of loading it. Columns stand on parts below, the floor, or a wall-anchored part.
- Loads flow top-down through the contacts (tributary lengths).
- Beams: each span as simply supported, each overhang as a cantilever.
  - ULS: `σ = (1.35·M_G + 1.5·M_Q)/W ≤ k_mod·f_m,k/γ_M`
  - SLS: `δ_fin = δ_G(1+k_def) + δ_Q(1+ψ₂·k_def) ≤ L/300` (cantilever `L/150`); distributed loads are long-term (ψ₂ = 1), point loads short-term.
- Columns: EN 1995 §6.3.2 buckling factor `k_c`, effective length between bracing points.
- Material values: EN 338 classes (C24, D30–D40), EN 1995 tables 3.1/3.2 for `k_mod`/`k_def`, typical EN 636 / 622-5 / 312 / 300 panel values.

This is a design aid. For furniture people stand on or hang from, have an engineer check it.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # writes release/mushki-woodworks.html (single offline file)
```

Stack: Vite, React, TypeScript, three.js, zustand, fflate. UI fonts: Suez One and IBM Plex Sans Hebrew (bundled).
