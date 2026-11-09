#!/bin/zsh
# Sets up local speech-to-text for the Coach reel analyzer (whisper.cpp).
#
#   ./scripts/setup-whisper.sh            # multilingual "small" model (~466 MB, handles Hindi/Hinglish)
#   ./scripts/setup-whisper.sh base.en    # English-only "base" model (~142 MB, faster)
#
# Installs whisper-cpp with Homebrew (provides `whisper-cli`) and downloads the
# ggml model into ./storage/models (gitignored). The app picks up whichever
# model is there (small preferred); override with WHISPER_MODEL=/path/to/model.bin
# and WHISPER_BIN=/path/to/whisper-cli. Nothing secret is read or printed.
set -e
cd "${0:A:h}/.."

MODEL=${1:-small}
case $MODEL in
  small|base|base.en|small.en|tiny|tiny.en) ;;
  *) print "Unknown model '$MODEL'. Use one of: small, base.en, base, small.en, tiny.en"; exit 1 ;;
esac

BREW=/opt/homebrew/bin/brew
[[ -x $BREW ]] || BREW=$(command -v brew || true)

if ! command -v whisper-cli >/dev/null 2>&1 && [[ ! -x /opt/homebrew/bin/whisper-cli ]]; then
  [[ -n $BREW ]] || { print "Homebrew not found. Install it from https://brew.sh first."; exit 1; }
  print "Installing whisper-cpp with Homebrew..."
  $BREW install whisper-cpp
else
  print "whisper-cli already installed."
fi

if ! command -v ffmpeg >/dev/null 2>&1 && [[ ! -x /opt/homebrew/bin/ffmpeg ]]; then
  [[ -n $BREW ]] && { print "Installing ffmpeg..."; $BREW install ffmpeg; }
fi

mkdir -p storage/models storage/uploads
OUT=storage/models/ggml-$MODEL.bin
if [[ -s $OUT ]]; then
  print "Model already downloaded: $OUT"
else
  URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
  print "Downloading $URL ..."
  curl -L --fail --progress-bar -o "$OUT.part" "$URL"
  mv "$OUT.part" "$OUT"
  print "Saved $OUT"
fi

print "Done. Restart the web app so the Coach picks up the model (or just analyze a reel; it checks on every run)."
