import pandas as pd

# Replace 'your_file.csv' with the actual path to your CSV file
file_path = './perfumeReviews20k.csv'

# Read the CSV file into a DataFrame
df = pd.read_csv(file_path)

vector_column = 'embedding'
field_to_select = 'url'

# Convert the vector column to a string to use duplicated()
df[vector_column] = df[vector_column].astype(str)

# Find duplicated vectors
duplicated_vectors = df[df.duplicated(subset=vector_column, keep=False)]

# Count the number of replicated vectors
replicated_vectors_count = duplicated_vectors.shape[0]
replicated_vector_counts = duplicated_vectors[vector_column].value_counts()

#selected_field_for_replicated_vectors = duplicated_vectors[[field_to_select]]
# with pd.option_context('display.max_colwidth', 100):
#   print(selected_field_for_replicated_vectors[0:10])

print(f"Number of replicated vectors: {replicated_vectors_count}")
print(f"Number of occurrences for each replicated vector: {[n for n in replicated_vector_counts]}")