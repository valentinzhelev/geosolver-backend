# GeoSolver Backend Instructions

This repository contains GeoSolver's backend/API/database/server-side services.

Current stack must be verified from package.json.

## Security first

Never treat Node vm execution as a trusted security boundary.

Teacher-authored executable code must not be considered safe simply because it runs inside vm.

Do not expose secrets or process.env.

Do not loosen auth/role/subscription middleware without explicit justification.

## Canonical systems

Current classroom architecture:
Course / Assignment / TaskTemplate / Submission

Legacy:
Class / Student and old submissions routes

Do not build new functionality on legacy classroom models.

Current billing:
Stripe billing + verified webhook + StripeEvent idempotency

Legacy:
manual Subscription / Payment system

Do not build new billing behavior on the legacy system.

Do not delete production collections without explicit approval and backup verification.

## API

Maintain explicit authentication and authorization.

New endpoints should:
- validate input
- return structured errors
- respect locale where appropriate
- enforce correct user/resource ownership
- avoid leaking internal errors/secrets

## OCR/Capture

Current implementation:
Google Cloud Vision + extractionService.

Treat it as OCR v1.

Future OCR architecture should separate:

upload
→ preprocessing
→ provider
→ normalized OCR result
→ document/template interpretation
→ geodetic domain validation
→ confidence/review
→ persistence/integration

Do not hardwire future Capture workflows directly to Google Vision response structures.

Provider-specific data should be translated into an internal normalized schema.

No OCR provider is the mathematical source of truth.

## Geodetic validation

OCR output must be considered untrusted input.

Validate recognized geodetic values before calculation.

Human correction and confirmation must remain possible.

## Database

Do not mutate production data without explicit permission.

Schema changes must be backwards-aware.

Before removing legacy models/collections:
- verify actual production usage
- plan backup/export
- distinguish route/code removal from physical collection deletion

## Testing

Backend behavior must gain and maintain an executable test harness.

Security, auth, core API contracts and critical calculations should be regression-tested.

Never delete or weaken tests merely to make builds pass.

## Git

Do not commit or push unless explicitly requested.

Never force push.
Never reset --hard without explicit instruction.
