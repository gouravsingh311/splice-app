---
description: Auto-select and apply the best skills for the current task
---

You are now in **Auto Skill Mode**. Follow these steps:

1. **Understand the request**: Read the user's request carefully and identify what type of task it is (e.g. Electron, FastAPI, React, Python, Docker, database, etc.)

2. **Scan available skills**: List all skill directories in `.agent/skills/` to see what is available.

3. **Pick the best matching skills** (1–3 max) based on the task. Use this mapping as a guide:
   - Electron app / desktop / IPC → `electron`, `electron-ipc`, `desktop`
   - FastAPI / Python API → `fastapi-expert`, `fastapi-endpoint`, `fastapi-templates`
   - React / UI components → `react`, `react-components`, `shadcn-ui`, `frontend-design`
   - Python code → `python-expert`, `python-error-handling`, `python-type-safety`
   - Database / migrations → `postgresql`, `db-migrations-schema-changes`
   - Docker / deployment → `docker-expert`, `deployment-pipeline-design`
   - GitHub / CI → `github`, `gh-fix-ci`, `github-actions-templates`
   - Testing → `python-testing-patterns`, `playwright-e2e-builder`, `qa-expert`
   - Redis → `redis-best-practices`, `redis-development`
   - Background jobs → `python-background-jobs`
   - Auth → `auth-implementation-patterns`
   - API design → `api-design-principles`, `api-patterns`, `api-security-best-practices`
   - S3 / storage → `s3`
   - Observability / logging → `python-observability`, `error-tracking`
   - Documentation / writing → `technical-writer`, `design-md`
   - Airtable → `airtable`, `airtable-automation`
   - Dropbox → `dropbox-automation`, `dropbox-lite`

4. **Read each selected skill's SKILL.md**: Use `view_file` to read `.agent/skills/{skill-name}/SKILL.md` for each chosen skill.

5. **Tell the user** which skills you selected and why (1 sentence each).

6. **Execute the task** following the combined instructions from all selected skills.
