content = open('src/App.jsx', 'r', encoding='utf-8').read()
lines = content.split('\n')
for i, line in enumerate(lines[660:675], 661):
    print(f'{i}: {repr(line)}')
