# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repo is the early-stage scaffold for **ChangeScout** (社内コードネーム: Project Lighthouse), a solo-founder AI market-intelligence business. It is currently a **planning/documentation repository, not an application** — most directories contain only placeholder `README.md` stub files (a single header line), and there is no build system, package manager, source code, or test suite yet. Do not assume standard build/lint/test commands exist; check before inventing tooling. When the first real product is scaffolded inside `src/`, `products/`, or `website/`, this file should be updated with actual dev/build/test commands and real architecture notes.

Almost all substantive content in this repo is written in **Japanese**. Match that language when editing or adding to existing docs unless told otherwise.

## Directory layout and intent

- `docs/strategy/PROJECT.md` — the project charter: mission, vision, target market, revenue strategy, product portfolio candidates, and decision rules for what gets built. This is the authoritative source of business direction; read it before proposing new products or features. See summary below.
- `docs/strategy/ROADMAP.md` — roadmap (currently a stub).
- `docs/ development/` — architecture/dev docs (currently stubs: `README.md`, `architecture.md`). Note the literal leading space in the folder name (`docs/ development`, not `docs/development`) — preserve it exactly when referencing this path.
- `docs/marketing/`, `docs/meeting/`, `docs/BRAND.md` — marketing notes, meeting minutes, and brand guidelines (currently stubs).
- `database/opportunities.csv` — intended as a running database of market/business opportunities (currently empty).
- `reports/Report-001.md` — market/opportunity reports produced for the business (currently empty).
- `products/` — intended home for individual product definitions under the Project Lighthouse portfolio (currently a stub).
- `prompts/chatgpt.md`, `prompts/claude.md`, `prompts/gemini.md` — per-AI prompt/role notes corresponding to the "AI Roles" division below (currently stubs).
- `src/` — intended home for shared/reusable application code once development starts (currently a stub).
- `website/` — intended home for the marketing/product website (currently a stub).

## Project charter summary (from `docs/strategy/PROJECT.md`)

- **Mission**: Use AI to drastically cut the time businesses and individuals spend on information gathering, analysis, and decision-making — turning change into value ("変化を価値へ").
- **Vision**: Build a "small but strong" AI-era software company where one person plus multiple AIs can continuously ship new services.
- **Current goal**: ¥1,000,000 MRR within 12 months; first milestone is the first ¥10,000 of revenue.
- **Target market**: BtoB first — candidate segments are tax accountants (税理士), construction (建設), subsidies (補助金), regulatory/legal change (法改正), back-office (バックオフィス), and SMEs (中小企業).
- **Revenue funnel**: free report → email signup → free tool → SaaS → paid subscription.
- **Product portfolio candidates** (Project Lighthouse): AI Opportunity Report, Change Radar, AI Sales OS, Tender Watch, Tax Watch.
- **AI role division** — respect this when deciding what kind of work to do in this repo:
  - **ChatGPT**: CEO support, market analysis, pricing strategy, sales strategy, business planning.
  - **Claude Code**: design, development, code review, refactoring.
  - **Gemini**: market research, competitive analysis, news gathering, overseas/international research.
- **Long-term assets** the company is deliberately building (not just code): market database, opportunity database, reports, blog, sales templates, AI prompts, shared dev foundation.
- **Decision rule for new ideas** — only pursue an idea if all of the following hold: the customer is clearly defined, the first 100 target companies are reachable without paid ads, an MVP can be built in 30–50 hours, it fits a monthly subscription model, and it grows a reusable asset for other products.
- **Core principles**: build fast over perfect, validate in the market before building, automate repetitive work, favor reusable assets, focus on customer problems over technology.

When asked to help with strategy, product ideas, or reports in this repo, evaluate suggestions against the decision rule and target market above rather than proposing generic SaaS ideas.
