#!/bin/zsh
# One-time secret setup for DM Desk. Fills generated secrets and asks for the
# Anthropic key without echoing it. Nothing secret is printed.
set -e
cd "${0:A:h}/.."
F=.env
[[ -f $F ]] || cp .env.example $F
chmod 600 $F

setkey() { # setkey NAME VALUE  (replace line or append)
  local k=$1 v=$2
  if grep -q "^$k=" $F; then
    K="$k" V="$v" perl -i -pe 's/^\Q$ENV{K}\E=.*$/$ENV{K}=$ENV{V}/' $F
  else
    print -r -- "$k=$v" >> $F
  fi
}
isplaceholder() { # true if key empty or still the example value
  local cur=$(grep "^$1=" $F | head -1 | cut -d= -f2-)
  [[ -z $cur || $cur == replace-with* || $cur == 0123456789abcdef* || $cur == your-* ]]
}

setkey NEXTAUTH_URL "https://instagram.ahumlabs.com"
setkey DATABASE_URL "postgresql://$USER@localhost:5432/dmdesk"
isplaceholder NEXTAUTH_SECRET     && setkey NEXTAUTH_SECRET "$(openssl rand -base64 32)"
isplaceholder CRON_SECRET         && setkey CRON_SECRET "$(openssl rand -base64 32)"
isplaceholder ENCRYPTION_KEY      && setkey ENCRYPTION_KEY "$(openssl rand -hex 32)"
isplaceholder WEBHOOK_VERIFY_TOKEN && setkey WEBHOOK_VERIFY_TOKEN "$(openssl rand -hex 16)"

if isplaceholder ANTHROPIC_API_KEY; then
  print -n "Paste your Anthropic API key (hidden), then press Return: "
  read -rs KEY; print
  [[ -n $KEY ]] && setkey ANTHROPIC_API_KEY "$KEY" && print "Saved."
fi
print "Done. Secrets written to .env (not printed). You can close this tab."
