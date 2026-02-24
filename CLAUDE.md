# Project Rules

## UI/UX Design

- **Design Style**: All new UI features and components must use a **neomorphic (neumorphism)** design style
- Neomorphic characteristics: soft shadows, subtle depth, rounded corners, light/dark shadow pairs that create an embossed or debossed look
- Use CSS `box-shadow` with dual light/dark shadows rather than Material elevation
- Maintain compatibility with the existing light/dark theme toggle (`.theme-dark` class)

## Tech Stack

- **Frontend**: Angular with Angular Material (M2), Bootstrap grid, SCSS
- **Backend**: NestJS with Prisma ORM, PostgreSQL
- **Auth**: Passport.js (Google OAuth, OIDC, JWT, API Keys, WebAuthn)
- **Monorepo**: Nx workspace

## Existing Theme Reference

- Primary color: `#36cfcc` (teal/cyan)
- Secondary color: `#3686cf` (blue)
- Font: Inter (Roboto fallback)
- CSS variables defined in `apps/client/src/styles.scss`
- Theme config in `apps/client/src/styles/theme.scss`

## Deployment

- Hosted on **Railway** with PostgreSQL
- Environment variables managed via Railway's Variables tab
- Domain: `app.ghostclone.xyz`
