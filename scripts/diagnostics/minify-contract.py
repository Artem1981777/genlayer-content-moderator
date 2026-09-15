from pathlib import Path
import io
import tokenize

source_path = Path('contracts/registry_v2.py')
text = source_path.read_text()
tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
kept = []
for tok in tokens:
    if tok.type == tokenize.COMMENT:
        continue
    if tok.type == tokenize.ENCODING:
        continue
    kept.append(tok)
stripped = tokenize.untokenize(kept)
lines = [line.rstrip() for line in stripped.splitlines() if line.strip()]
out = '\n'.join(lines) + '\n'
print(f'original_bytes={len(text.encode())}')
print(f'comments_removed_bytes={len(out.encode())}')
print(f'saved_bytes={len(text.encode()) - len(out.encode())}')
Path('artifacts').mkdir(exist_ok=True)
Path('artifacts/registry_v2.min.py').write_text(out)
print('artifact=artifacts/registry_v2.min.py')
