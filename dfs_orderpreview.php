<?php
/**
 * DFS Order Preview
 *
 * @author    Cyrille Mohr - Digital Food System
 * @copyright Digital Food System
 * @license   Commercial
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

$autoloadPath = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoloadPath)) {
    require_once $autoloadPath;
}

class Dfs_Orderpreview extends Module
{
    public function __construct()
    {
        $this->name = 'dfs_orderpreview';
        $this->tab = 'administration';
        $this->version = '1.0.0';
        $this->author = 'Cyrille Mohr - Digital Food System';
        $this->need_instance = 0;
        $this->bootstrap = true;

        parent::__construct();

        $this->displayName = $this->l('DFS Order Preview');
        $this->description = $this->l('Tooltips au survol dans la liste des commandes Back-Office.');
        $this->ps_versions_compliancy = ['min' => '9.0.0', 'max' => _PS_VERSION_];
    }

    public function install(): bool
    {
        return parent::install()
            && $this->registerHook('displayBackOfficeHeader');
    }

    public function uninstall(): bool
    {
        return parent::uninstall();
    }

    /**
     * Injecte le CSS et le JS uniquement sur la page AdminOrders.
     * Passe les URLs des routes AJAX au JS via Media::addJsDef().
     */
    public function hookDisplayBackOfficeHeader(): void
    {
        $request = $this->get('request_stack')->getCurrentRequest();

        if (!$request) {
            return;
        }

        if ($request->get('_legacy_controller') !== 'AdminOrders') {
            return;
        }

        $router = $this->get('router');

        // Le token CSRF du BO est requis dans les routes de modules PS9.
        // On le récupère via le TokenManager et on l'inclut dans les URLs.
        $tokenManager = $this->get('prestashop.core.admin.url_generator_factory');
        $token = $this->context->controller->token ?? '';

        // Génération des URLs avec orderId=0 (placeholder remplacé par le JS)
        // et token inclus directement.
        $buildUrl = function (string $route) use ($router, $token): string {
            $url = $router->generate($route, ['orderId' => 0]);
            if ($token) {
                $separator = (strpos($url, '?') !== false) ? '&' : '?';
                $url .= $separator . '_token=' . urlencode($token);
            }
            return $url;
        };

        Media::addJsDef([
            'dfsOp' => [
                'urlProducts' => $buildUrl('dfs_op_tooltip_products'),
                'urlDelivery' => $buildUrl('dfs_op_tooltip_delivery'),
                'urlCustomer' => $buildUrl('dfs_op_tooltip_customer'),
            ],
        ]);

        $this->context->controller->addCSS($this->getPathUri() . 'views/css/bo_orders.css');
        $this->context->controller->addJS($this->getPathUri() . 'views/js/bo_orders.js');
    }
}
