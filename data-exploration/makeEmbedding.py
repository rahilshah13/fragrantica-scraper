import sys
import psycopg2
import numpy as np
from psycopg2 import sql
import ast
# todo rename to analyzeEmbedding

dbname = "EmbeddingsDB"
user = "postgres"
password = "<FILL IN>"
host = "<FILL IN>"
port = "5432"

promptEmbedding = []
contents = ""
print(sys.argv[1])
with open("./embeddings/{}.txt".format(sys.argv[1][0:12]), "r") as f:
    contents = f.read()
    promptEmbedding = np.array(ast.literal_eval(contents))
    
print(promptEmbedding)

connection = psycopg2.connect(
    dbname=dbname,
    user=user,
    password=password,
    host=host,
    port=port
)

cursor = connection.cursor()
select_query = "SELECT url, embedding <=> '{}' AS cosine_distance FROM embeddings WHERE type='description' ORDER BY cosine_distance DESC LIMIT 10;".format(contents)

cursor.execute(select_query)
rows = cursor.fetchall()


def euclidean_distance(arr2):
    return np.linalg.norm(promptEmbedding - np.array(arr2))

def cosin_d(arr2):
    arr1 = np.array(promptEmbedding)
    arr2 = np.array(ast.literal_eval(arr2))

    dot_product = np.dot(arr1, arr2)
    magnitude_arr1 = np.linalg.norm(arr1)
    magnitude_arr2 = np.linalg.norm(arr2)

    # Ensure denominators are not zero
    if magnitude_arr1 == 0 or magnitude_arr2 == 0:
        raise ValueError("Input arrays must not be zero vectors.")

    cosine_similarity = dot_product / (magnitude_arr1 * magnitude_arr2)
    return 1 - cosine_similarity

#rows = [(r[0], cosin_d(r[2])) for r in rows]
print("\n".join([str(r) for r in rows]))