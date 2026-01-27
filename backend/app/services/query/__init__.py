"""Query Processing & Special Handlers services."""
from .processing import preprocess_query, extract_keywords
from .special_handlers import is_special_prompt, execute_special_handler
