---
title: ConceptIntel Backend
emoji: 🧠
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# ConceptIntel Backend

FastAPI backend for ConceptIntel, running as a Docker Space.

This file's YAML frontmatter (above) is what tells Hugging Face Spaces to
build `Dockerfile` and route traffic to port 7860 - it must live at the ROOT
of the Space's own git repo, replacing whatever placeholder README the Space
was created with. See `backend/deploy/huggingface/README.md` in the main
ConceptIntel repo for the full setup walkthrough.
