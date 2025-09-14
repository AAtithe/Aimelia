from fastapi import FastAPI
from .graph_auth import router as auth_router
from .outlook import router as email_router
from .calendar import router as cal_router

app = FastAPI(title="Aimelia API")
app.include_router(auth_router)
app.include_router(email_router)
app.include_router(cal_router)

@app.get("/")
def root():
    return {"aimelia": "ok"}