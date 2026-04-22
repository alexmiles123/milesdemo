content = open('src/App.jsx', 'r', encoding='utf-8').read()

old = '    </Card>\n    </div>\n    <AiPanel portfolio={portfolio} tasks={tasks} csms={csms} />\n    </div>\n  );\n}'
new = '    </Card>\n    </div>\n    </div>\n    <AiPanel portfolio={portfolio} tasks={tasks} csms={csms} />\n    </div>\n  );\n}'

if old in content:
    content = content.replace(old, new, 1)
    print('Fixed!')
else:
    print('Pattern not found - checking exact content...')
    idx = content.find('AiPanel portfolio')
    print(repr(content[idx-100:idx+50]))

open('src/App.jsx', 'w', encoding='utf-8').write(content)
