# Lately backend — one image, two processes (fly.toml [processes]):
#   api    → uvicorn app.main:app
#   worker → python -m app.worker
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Never bake secrets into the image: DATABASE_URL, SUPABASE_*, LLM_*, GROQ_*,
# EMBEDDINGS_* and ADMIN_KEY come from `fly secrets set`.
RUN useradd --create-home --uid 10001 lately
USER lately

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
