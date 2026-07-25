# InnovateX Revenue OS

AI-native Revenue Operating System built for modern sales teams.

---

## Documentation

The complete product and engineering documentation is maintained separately.

| Document                                                          | Description                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 📘 [Master Product Specification](./FRONTEND/docs/MASTER_SPEC.md) | Product vision, business requirements, modules, workflows and implementation roadmap.                        |
| 🎨 [Frontend Specification](./FRONTEND/docs/FRONTEND_SPEC.md)     | Frontend architecture, routing, state management, UI implementation and development guide.                   |
| ⚙️ [Developer Handoff](./FRONTEND/docs/DEVELOPER_HANDOFF.md)      | Technical reference for developers including project structure, services, stores and implementation details. |

---

## Repository Structure

```
InnovateX/
├── BACKEND/
│   ├── src/
│   ├── .env.example
│   └── package.json
│
├── FRONTEND/
│   ├── docs/
│   ├── src/
│   ├── public/
│   └── package.json
│
└── README.md
```

---

## Quick Start

### Backend

```bash
cd BACKEND
npm install
cp .env.example .env
npm run dev
```

### Frontend

```bash
cd FRONTEND
npm install
cp .env.example .env
npm run dev
```

---

## Environment

### Backend

Configure all required environment variables in:

```
BACKEND/.env
```

Example configuration is available in:

```
BACKEND/.env.example
```

### Frontend

Configure the backend API endpoint in:

```
FRONTEND/.env
```

---

## Development Notes

- Frontend and backend are developed independently.
- Keep secrets only in local `.env` files.
- Never commit production credentials.
- Architecture decisions should be documented instead of being explained inside source code comments.
- The documentation inside `FRONTEND/docs` is the single source of truth for implementation.

---

## Branch Strategy

```
main        → Production-ready code
develop     → Active development
feature/*   → New features
bugfix/*    → Bug fixes
hotfix/*    → Production fixes
```

---

## License

This repository contains proprietary software developed for InnovateX.

Unauthorized copying, modification, distribution, or disclosure of any part of this repository is prohibited.
