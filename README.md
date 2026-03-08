# VeriAI 🔍

**VeriAI** is a Chrome extension that automatically fact-checks AI-generated responses in real time. It detects when an LLM responds on supported sites, extracts individual factual claims using **Llama (via OpenRouter)**, verifies each claim against Wikipedia and the web using the **Tavily Search API**, and injects a colour-coded audit card directly into the page — with per-claim verdicts and an overall accuracy score.

---

## ✨ Features

- 🤖 **Multi-Site LLM Detection** — Auto-detects AI responses on ChatGPT, Claude, Gemini, DeepSeek, Copilot, Perplexity, and more
- 🧠 **AI-Powered Claim Extraction** — Uses **Llama via OpenRouter** to parse responses into individual, checkable factual claims
- 🌐 **Live Fact-Checking** — Each claim is verified against Wikipedia and the web via the **Tavily Search API**
- 🟢🟡🔴 **Per-Claim Colour Scoring** — Every claim is scored and colour-coded: green (verified), yellow (uncertain), or red (contradicted)
- 📊 **Weighted Overall Score** — An aggregate accuracy % is calculated using a weighted algorithm that penalises red claims more heavily
- 💉 **Inline Audit Card** — Results are injected directly below the AI response on the page — no tab-switching needed
- 🔽 **Expandable Claim Breakdown** — Click **"Show claims"** on the audit card to expand a detailed view of every individual claim, its score, verdict, and a direct **"View source →"** link to the supporting web source
- ⚡ **Smart Selector Caching** — Learns and caches site-specific DOM selectors for faster detection on repeat visits

---

## 🗂️ Project Structure

```
VeriAI/
├── manifest.json         # Chrome Extension Manifest V3
├── background.js         # Service worker — orchestrates OpenRouter + Tavily API calls
├── content.js            # Content script — detects AI responses, injects audit cards
├── styles.css            # Audit card styles
├── popup/                # Extension popup UI
└── utils/
    └── scorer.js         # Pure scoring logic — claim evaluation & overall score calc
```

---

## 🚀 Getting Started

### Prerequisites

- **Google Chrome** browser
- A **Tavily API key** — get one free at [tavily.com](https://tavily.com)
- An **OpenRouter API key** — get one at [openrouter.ai](https://openrouter.ai)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Piyu1208/VeriAI.git
   cd VeriAI
   ```

2. **Open Chrome Extensions** — navigate to `chrome://extensions`

3. **Enable Developer Mode** — toggle the switch in the top-right corner

4. **Load the extension** — click **"Load unpacked"** and select the `VeriAI` folder

5. The VeriAI icon will appear in your Chrome toolbar

### Configuration

1. Click the **VeriAI icon** in your toolbar
2. Enter your **Tavily API key** and **OpenRouter API key**
3. Save — VeriAI will now fact-check AI responses automatically as you use any supported LLM site

---

## 🎯 How It Works

```
LLM responds on page
        ↓
  content.js detects the response node
  (MutationObserver + multi-strategy selector detection)
        ↓
  Text sent to background.js via chrome.runtime.sendMessage
        ↓
  Llama (OpenRouter) extracts individual factual claims
        ↓
  Each claim queried against Tavily Search API
  (Wikipedia + web sources)
        ↓
  scorer.js evaluates each claim:
  🟢 Green (≥75%)  🟡 Yellow (40–74%)  🔴 Red (<40%)
        ↓
  Weighted overall accuracy % calculated
        ↓
  Audit card injected inline below the AI response
  → Click "Show claims ▾" to expand per-claim breakdown
  → Each claim shows its score, verdict & "View source →" link
```

---

## 🛠️ Tech Stack

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest_V3-34A853?style=for-the-badge&logo=googlechrome&logoColor=white)
![Llama](https://img.shields.io/badge/Llama_(OpenRouter)-6B21A8?style=for-the-badge&logo=meta&logoColor=white)
![Tavily API](https://img.shields.io/badge/Tavily_API-0EA5E9?style=for-the-badge&logo=searchengin&logoColor=white)
![Wikipedia](https://img.shields.io/badge/Wikipedia-000000?style=for-the-badge&logo=wikipedia&logoColor=white)

---

## 🌐 Supported LLM Sites

VeriAI uses a multi-strategy DOM detection system and works out of the box on:

| Site | Detection Method |
|---|---|
| ChatGPT | `[data-message-author-role="assistant"]` |
| Claude | `[data-is-streaming="false"]` + `.font-claude-message` |
| Gemini | `model-response` + `.markdown` |
| DeepSeek | `.ds-markdown` |
| Copilot / Perplexity | aria-label heuristics |
| Custom/OSS LLM UIs | Generic `data-role`, `data-sender`, class-pattern matching |

If a site isn't in the known list, VeriAI falls back through 5 progressive detection strategies — aria-labels, class-name patterns, `role=log` heuristics, and a largest-text-block fallback — before caching the working selector for future visits.

---

## 📊 Scoring Algorithm

Claim scoring is handled entirely in `utils/scorer.js` — a pure function with no side effects.

### Per-Claim Score

Each claim is evaluated against its Tavily search result using a priority-ordered signal chain:

| Priority | Condition | Score | Color |
|---|---|---|---|
| 1 | Top source relevance ≥ 0.7 + corroboration signals | 88–95% | 🟢 Green |
| 2 | Keyword overlap ≥ 50% + avg relevance ≥ 0.4 | 83–92% | 🟢 Green |
| 3 | Corroboration signals OR avg relevance ≥ 0.4 | 78–87% | 🟢 Green |
| 4 | Contradiction phrase detected (after green paths fail) | 10–25% | 🔴 Red |
| 5 | Strong keyword overlap, no clear signals | 65% | 🟡 Yellow |
| 6 | Weak overall match | 45% | 🟡 Yellow |
| — | Search unavailable | 50% | 🟡 Yellow |
| — | Zero results returned | 40% | 🟡 Yellow |

**Key design decisions:**
- **Green is evaluated before red** — strong corroboration evidence overrides weak contradiction signals, preventing false positives
- **Contradiction uses phrase matching**, not single words — terms like "false", "wrong", or "myth" appear constantly in neutral Wikipedia text and would cause false positives as single-word signals
- **Keyword overlap fallback** handles format mismatches (e.g. different date formats) where Tavily relevance scores alone would underrate a valid match

### Overall Score (Weighted Average)

Red claims are penalised more heavily to reflect their outsized importance:

```
Weight per claim:
  score < 40%  →  weight 2.0   (red — high penalty)
  score < 75%  →  weight 1.5   (yellow — moderate penalty)
  score ≥ 75%  →  weight 1.0   (green — no penalty)

Overall = round( Σ(score × weight) / Σ(weight) )
```

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "Add your feature"`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📄 License

This project is open source. See the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**Team 5** — [GitHub Profile](https://github.com/Piyu1208)

---

> *VeriAI — Don't just read AI. Verify it.*
