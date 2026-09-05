FROM mwader/static-ffmpeg:8.1.2@sha256:33f770f812cbfc3de96c547157fc9faf8bd95a36481753439ffa761045167585 AS ffmpeg

FROM python:3.12-slim

COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./app.py
COPY watchless_translation.py ./watchless_translation.py
COPY watchless_provider.py ./watchless_provider.py

RUN useradd --create-home --uid 10001 watchless \
  && mkdir -p /work \
  && chown -R watchless:watchless /app /work
USER watchless

ENV PYTHONUNBUFFERED=1 PORT=8080
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
