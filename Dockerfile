# Use Python 3.12 slim image
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# No system build dependencies needed.
# `psycopg2-binary` ships precompiled wheels bundling their own libpq, so gcc and
# libpq-dev are unnecessary. (They WOULD be required if this ever switches to
# source-built `psycopg2` — if pip starts failing on a compile step, that is why.)

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Collect static files
# NOTE: this must succeed. Do NOT suppress errors (e.g. `2>/dev/null || true`) —
# a silent failure here ships a container whose site loads with no CSS/JS and no error.
RUN ENVIRONMENT=collectstatic python manage.py collectstatic --noinput

# Non-root runtime user (S1-14): uvicorn and everything after this point run
# as 'app', so a code-execution bug cannot escalate to root in the container.
# Static files were collected above as root and stay world-readable.
RUN useradd --system --no-create-home app
USER app

# Expose port
EXPOSE 8080

# Run with uvicorn (ASGI). JSON/exec form: uvicorn runs as PID 1 and receives
# SIGTERM directly, so Cloud Run scale-down and revision swaps shut down cleanly
# instead of being SIGKILLed after the grace period.
CMD ["uvicorn", "danielmherman.asgi:application", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "2", \
     "--timeout-keep-alive", "120"]