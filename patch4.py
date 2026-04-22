content = open('src/App.jsx', 'r', encoding='utf-8').read()
old = 'minHeight:"100vh",background:G.bg,color:G.text,fontFamily:"Syne,sans-serif",display:"flex",flexDirection:"column"'
new = 'height:"100vh",background:G.bg,color:G.text,fontFamily:"Syne,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden"'
content = content.replace(old, new, 1)
open('src/App.jsx', 'w', encoding='utf-8').write(content)
print('Fixed:', 'height:"100vh"' in content)
