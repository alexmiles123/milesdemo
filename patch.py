content = open('src/App.jsx', 'r', encoding='utf-8').read()

old1 = 'flex:1,overflowY:"auto",padding:"18px 24px",animation:"fadein .3s ease"}}>'
new1 = 'flex:1,display:"flex",overflow:"hidden"}}><div style={{flex:1,overflowY:"auto",padding:"18px 24px",animation:"fadein .3s ease"}}>'
content = content.replace(old1, new1, 1)

idx = content.find('CONSULTANT PORTAL')
chunk = content[idx-30:idx+20]
print('Around CONSULTANT:', repr(chunk))

open('src/App.jsx', 'w', encoding='utf-8').write(content)
print('Step 1 done. Flex wrap applied:', 'flex:1,display:\"flex\"' in content)
