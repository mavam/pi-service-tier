---
title: Dependency-free fancy footer integration
type: change
authors:
  - mavam
  - codex
prs:
  - 2
created: 2026-07-23T17:56:34.875581Z
---

The optional service-tier footer indicator now talks to `pi-fancy-footer`
through its event protocol and no longer relies on its package API.

Install both extensions as before to see `⚡` whenever the active model has a
configured service tier. The indicator republishes when the footer becomes
ready, so extension load order does not matter.
