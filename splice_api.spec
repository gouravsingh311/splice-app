# splice_api.spec
block_cipher = None
a = Analysis(
  ['apps/api/run.py'],
  pathex=['.'],
  binaries=[],
  datas=[],
  hiddenimports=[
    'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto',
    'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan', 'uvicorn.lifespan.on',
    'fastapi', 'pydantic', 'pydantic.v1',
    'multipart', 'email.mime.multipart', 'email.mime.text',
    'sqlite3', 'hashlib', 'hmac',
  ],
  hookspath=[],
  runtime_hooks=[],
  excludes=['tkinter'],
  cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(pyz, a.scripts, a.binaries, a.zipfiles, a.datas,
  name='splice_api', debug=False, strip=False, upx=True, console=True)
