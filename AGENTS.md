# Dynamic Pricing Engine — Agent Instructions

You are working on an AI-Powered Dynamic Pricing Engine.

Work fast and stay scoped. Do not over-engineer.

Project stack:
- apps/api: Node.js + Express backend
- apps/web: React + TypeScript frontend
- apps/ml-service: Python FastAPI ML service
- database: PostgreSQL migrations and seed files
- Redis will be used later for Bull queues

Rules:
- Only edit files needed for the current task.
- Do not create frontend/backend code unless the task asks.
- Do not install packages unless the task asks.
- Do not run long experiments.
- Prefer simple, readable code.
- Keep changes interview-explainable.
- After changes, summarize touched files and exact commands to run.
- Stop after completing the requested task.

For SQL:
- Use PostgreSQL 16 syntax.
- Use UUID primary keys with gen_random_uuid().
- Use DECIMAL for money.
- Use TIMESTAMPTZ for timestamps.
- Use JSONB for flexible product metadata.
- Add useful indexes, not random indexes.