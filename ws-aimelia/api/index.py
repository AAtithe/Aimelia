"""
Vercel serverless entry point for Aimelia API
"""
import sys
import os

# Add the app directory to Python path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'apps', 'api', 'app'))

from main import app

# Vercel expects the app to be named 'app'
# This is already the case from our main.py import