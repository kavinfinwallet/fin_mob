const pool = require('../config/database');

const categorizeTransaction = async (description, userId) => {
  try {
    // Get user's categories
    const categoriesResult = await pool.query(
      'SELECT id, name, keywords FROM categories WHERE user_id = $1',
      [userId]
    );
    
    const categories = categoriesResult.rows;
    const descriptionLower = description.toLowerCase();
    
    // Check each category's keywords
    for (const category of categories) {
      if (category.keywords && category.keywords.length > 0) {
        for (const keyword of category.keywords) {
          if (descriptionLower.includes(keyword.toLowerCase())) {
            return {
              categoryId: category.id,
              categoryName: category.name
            };
          }
        }
      }
    }
    
    // Default category if no match
    return {
      categoryId: null,
      categoryName: 'Uncategorized'
    };
  } catch (error) {
    console.error('Categorization error:', error);
    return {
      categoryId: null,
      categoryName: 'Uncategorized'
    };
  }
};

const categorizeTransactions = async (transactions, userId) => {
  const categorized = [];
  
  for (const transaction of transactions) {
    const category = await categorizeTransaction(transaction.description, userId);
    categorized.push({
      ...transaction,
      categoryId: category.categoryId,
      categoryName: category.categoryName
    });
  }
  
  return categorized;
};

module.exports = {
  categorizeTransaction,
  categorizeTransactions
};



