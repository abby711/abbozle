# Abbozle

Little apps I build so I don't have to pay for subscriptions.

**Live:** https://abby711.github.io/abbozle/

| App | What it is | Link |
| --- | --- | --- |
| Words | Unlimited five-letter word puzzles: six tries, hard mode, dark and high-contrast themes, stats and streaks, shareable results | [Play](https://abby711.github.io/abbozle/words/) |

## How this repo is organized

Every app lives in its own folder and is plain HTML, CSS and JavaScript. There's no build step: GitHub Pages serves the files as they are.

```
abbozle/
├── index.html        ← home page that lists every app
├── README.md
└── words/            ← one folder per app
    ├── index.html
    ├── style.css
    ├── game.js
    └── words.js
```

## Adding a new app

1. Create a folder, e.g. `notes/`, with an `index.html` inside.
2. Open the root `index.html` and add an entry to the `APPS` list:
   ```js
   { name: 'Notes', path: 'notes/', tag: 'Tool', description: 'What it does.', icon: '📝' }
   ```
3. Add a row to the table above, commit and push. It's live at `https://abby711.github.io/abbozle/notes/` a minute later.

## Running locally

Open `index.html` in a browser, or serve the folder so links behave exactly like GitHub Pages:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Publishing (one-time setup)

1. Push this folder to a public GitHub repo named `abbozle`.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
3. Every push to `main` updates the site automatically.

## Credits

- Words: word lists from the [`wordle-words`](https://www.npmjs.com/package/wordle-words) package (MIT, © 2022 Michael Chan).
- Everything else: built by [abby711](https://github.com/abby711).
