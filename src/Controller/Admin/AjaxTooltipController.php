<?php
/**
 * DFS Order Preview
 *
 * @author    Cyrille Mohr - Digital Food System
 * @copyright Digital Food System
 * @license   Commercial
 */

declare(strict_types=1);

namespace DfsOrderpreview\Controller\Admin;

use Address;
use Carrier;
use Configuration;
use Customer;
use Module;
use Order;
use PrestaShopBundle\Controller\Admin\PrestaShopAdminController;
use PrestaShopBundle\Security\Attribute\AdminSecurity;
use Store;
use Symfony\Component\HttpFoundation\JsonResponse;
use Validate;

class AjaxTooltipController extends PrestaShopAdminController
{
    // -------------------------------------------------------------------------
    // Actions publiques — une par type de tooltip
    // -------------------------------------------------------------------------

    /**
     * Retourne la liste des produits d'une commande (colonnes ID / Référence / Nouveau client).
     */
    #[AdminSecurity('is_granted("ROLE_MOD_TAB_ADMINORDERS_READ")')]
    public function productsAction(int $orderId): JsonResponse
    {
        $order = new Order($orderId);

        if (!Validate::isLoadedObject($order)) {
            return $this->jsonError();
        }

        $products = $order->getProductsDetail();

        $lines = [];
        foreach ($products as $product) {
            $lines[] = [
                'name' => $product['product_name'],
                'qty'  => (int) $product['product_quantity'],
            ];
        }

        return new JsonResponse(['lines' => $lines]);
    }

    /**
     * Retourne les informations de livraison d'une commande (colonne Livraison).
     * Intègre les données DFS Click & Collect si disponibles.
     */
    #[AdminSecurity('is_granted("ROLE_MOD_TAB_ADMINORDERS_READ")')]
    public function deliveryAction(int $orderId): JsonResponse
    {
        $order = new Order($orderId);

        if (!Validate::isLoadedObject($order)) {
            return $this->jsonError();
        }

        $langId  = (int) \Context::getContext()->language->id;
        $address = new Address($order->id_address_delivery);
        $carrier = new Carrier($order->id_carrier, $langId);

        // Récupération C&C avant construction du payload
        $ccData = $this->getClickCollectData($orderId);

        // Si retrait boutique : composer le label transporteur "Nom — Boutique de Strasbourg"
        // (même logique que le module Picking List : CONCAT(carrier.name, ' — ', store_lang.name))
        $carrierLabel = $carrier->name;
        if ($ccData !== null && !empty($ccData['store_name'])) {
            $carrierLabel = $carrier->name . ' — ' . $ccData['store_name'];
            // store_name est désormais porté par carrier : on le retire du sous-objet C&C
            unset($ccData['store_name']);
        }

        $data = [
            'carrier'      => $carrierLabel,
            'firstname'    => $address->firstname,
            'lastname'     => $address->lastname,
            'address1'     => $address->address1,
            'address2'     => $address->address2 ?: '',
            'postcode'     => $address->postcode,
            'city'         => $address->city,
            'phone'        => $address->phone ?: $address->phone_mobile ?: '',
            'clickcollect' => $ccData,
        ];

        return new JsonResponse($data);
    }

    /**
     * Retourne les informations du client d'une commande (colonne Client).
     */
    #[AdminSecurity('is_granted("ROLE_MOD_TAB_ADMINORDERS_READ")')]
    public function customerAction(int $orderId): JsonResponse
    {
        $order = new Order($orderId);

        if (!Validate::isLoadedObject($order)) {
            return $this->jsonError();
        }

        $customer = new Customer($order->id_customer);
        // Le téléphone de commande est celui de l'adresse de livraison
        $address  = new Address($order->id_address_delivery);

        $data = [
            'firstname' => $customer->firstname,
            'lastname'  => $customer->lastname,
            'email'     => $customer->email,
            'phone'     => $address->phone ?: $address->phone_mobile ?: '',
        ];

        return new JsonResponse($data);
    }

    // -------------------------------------------------------------------------
    // Intégration DFS Click & Collect — point d'entrée unique et isolé
    // -------------------------------------------------------------------------

    /**
     * Récupère les données Click & Collect pour une commande.
     *
     * Retourne NULL dans les cas suivants :
     * - Le module dfs_clickcollect n'est pas installé ou actif
     * - Aucun créneau n'est associé à cette commande
     * - Toute erreur inattendue (fail silencieux)
     *
     * Structure retournée si des données existent :
     * [
     *   'store_name' => string,  // Nom du magasin (PS Store::name)
     *   'day'        => string,  // Date format 'd/m/Y'
     *   'hour'       => string,  // Heure format 'HH:MM'
     * ]
     *
     * Source des données (module dfs_clickcollect) :
     * - Table  : ps_dfs_clickcollect_creneau (jointure id_order)
     * - Champs : id_store (→ Store PS natif), day (VARCHAR YYYY-MM-DD), hour (VARCHAR HH:MM)
     *
     * @todo Brancher ici si le module expose une méthode publique à l'avenir.
     */
    private function getClickCollectData(int $orderId): ?array
    {
        // --- Garde 1 : module absent ou désactivé ---
        if (!Module::isInstalled('dfs_clickcollect') || !Module::isEnabled('dfs_clickcollect')) {
            return null;
        }

        // --- Garde 2 : le transporteur de cette commande n'est pas le transporteur C&C ---
        // On évite une requête inutile si la commande n'est pas un retrait boutique.
        // DFS_DRIVE_CARRIER_ID stocke la référence du transporteur (pas l'id technique).
        $carrierRef = (int) Configuration::get('DFS_DRIVE_CARRIER_ID');
        if ($carrierRef > 0) {
            $order          = new Order($orderId);
            $activeCarrier  = \Carrier::getCarrierByReference($carrierRef);
            $matchingId     = $activeCarrier ? (int) $activeCarrier->id : $carrierRef;

            if ((int) $order->id_carrier !== $matchingId) {
                return null;
            }
        }

        // --- Lecture du créneau ---
        try {
            $slot = \Db::getInstance()->getRow(
                'SELECT id_store, day, hour
                 FROM `' . _DB_PREFIX_ . 'dfs_clickcollect_creneau`
                 WHERE id_order = ' . $orderId
            );

            if (empty($slot)) {
                return null;
            }

            // Résolution du nom du magasin via l'ObjectModel PS natif Store
            $langId = (int) \Context::getContext()->language->id;
            $store  = new Store((int) $slot['id_store'], $langId);

            return [
                'store_name' => Validate::isLoadedObject($store) ? $store->name : '',
                'day'        => !empty($slot['day'])  ? date('d/m/Y', strtotime($slot['day']))  : '',
                'hour'       => !empty($slot['hour']) ? $slot['hour'] : '',
            ];
        } catch (\Exception $e) {
            // Fail silencieux : aucune donnée C&C ne doit faire crasher le tooltip
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Utilitaire
    // -------------------------------------------------------------------------

    private function jsonError(): JsonResponse
    {
        return new JsonResponse(['error' => true], 404);
    }
}
