content = open('src/App.jsx', 'r', encoding='utf-8').read()
idx = content.find('CONSULTANT PORTAL')
print('Found CONSULTANT PORTAL at:', idx)
print('Context before:', repr(content[idx-60:idx]))
