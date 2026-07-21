# SADKO price-comparer engine.
# A stateful long-running Node server: SQLite catalog on disk, an in-memory
# offer index, background crawl/discovery waves, and a 15-minute refresher.
# This is NOT a serverless function — it needs a real always-on process and a
# persistent volume for site/data. See DEPLOY.md.

FROM node:24-slim

# node:sqlite (built in, needs no packages) + FTS5 are compiled into Node 24.
# Zero npm dependencies, so there is no `npm install` step.

WORKDIR /app
COPY site ./site

# The engine reads PORT from the environment; hosts set it (Fly/Render use 8080).
ENV PORT=8080
EXPOSE 8080

# Secrets are supplied as environment variables by the host, NOT baked in:
#   NVIDIA_API_KEY   optional — AI query understanding + relevance
#   TAVILY_API_KEY   optional — URL discovery for unreachable stores
# The engine runs fully without either (fails soft).

WORKDIR /app/site
CMD ["node", "compare-server.mjs"]
