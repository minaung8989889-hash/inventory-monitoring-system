"""Seed the MongoDB with sample tank data.
Run: python seed_data.py
"""
import os
import sys
import datetime
from pymongo import MongoClient

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from config import MONGO_URI, DATABASE_NAME

client = MongoClient(MONGO_URI)
db = client[DATABASE_NAME]

tank_collection = db['tank_data']

sample = []
now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
for i in range(1, 6):
    sample.append({
        'tank': f'TK10{i}',
        'level': 100 - i * 5,
        'temperature': 20 + i,
        'pressure': 1.0 + i * 0.1,
        'volume': 1000 + i * 10,
        'timestamp': now - datetime.timedelta(minutes=i * 5)
    })

res = tank_collection.insert_many(sample)
print('Inserted ids:', [str(x) for x in res.inserted_ids])
