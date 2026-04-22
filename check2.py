content = open('src/App.jsx', 'r', encoding='utf-8').read()
lines = content.split('\n')
start = max(0, 669)
end = min(len(lines), 676)
for i, line in enumerate(lines[start:end], start+1):
    print(f'{i}: {line}')
