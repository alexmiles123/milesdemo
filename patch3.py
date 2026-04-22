content = open('src/App.jsx', 'r', encoding='utf-8').read()

old = '</Card>\n    </div>\n  );\n}\n\n// \u2500\u2500\u2500 CONSULTANT PORTAL'
new = '</Card>\n    </div>\n    <AiPanel portfolio={portfolio} tasks={tasks} csms={csms} />\n    </div>\n  );\n}\n\n// \u2500\u2500\u2500 CONSULTANT PORTAL'
if old in content:
    content = content.replace(old, new, 1)
    print('AiPanel closing tag inserted OK')
else:
    print('NOT FOUND - checking...')
    idx = content.find('CONSULTANT PORTAL')
    print(repr(content[idx-80:idx]))

open('src/App.jsx', 'w', encoding='utf-8').write(content)
print('AiPanel in file:', 'AiPanel portfolio={portfolio}' in content)
